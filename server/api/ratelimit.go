package main

import (
	"net"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

// Auth-failure throttling.
//
// This is the sibling of server/ingest/ratelimit.go, copied rather than shared
// because ingest and api are separate Go modules by design. Keep the two in
// step: a change to the bucket policy belongs in both.
//
// The product API is guarded by a single static bearer token, and docs/ai.md
// tells a self-hoster to publish it — behind a proxy, to a ChatGPT Action.
// Ingest has had this limiter since SRV-7; the read API, which serves every
// health record the database holds, had nothing. Without a limit, that token
// can be guessed at line rate and nothing in the logs stands out. So each
// client IP gets a token bucket that ONLY failed authentications draw from: a
// successful request never costs a token, because a backfill is thousands of
// legitimate calls in a row and throttling those would break the product.
//
// Once a bucket is empty the request is refused with 429 *before* the token is
// compared. That ordering is the whole point: charging a failure but still
// answering 401/200 would let an attacker keep guessing at full speed and
// simply read the status code. An IP that is out of tokens learns nothing.
//
// The cost of IP-keyed limiting is that a legitimate client sharing an address
// with an attacker (carrier NAT, a shared proxy) is refused too. That is
// acceptable here: the buckets are small, they refill in minutes, and a phone
// with the right token that has never failed keeps its own bucket full.
const (
	// Tokens a fresh bucket holds — the burst an IP may spend at once.
	authFailureBurst = 10
	// Sustained refill, in failures per minute, once the burst is spent.
	authFailurePerMinute = 10
	// A full bucket untouched for this long is forgotten. Anything shorter
	// throws away buckets that are still refilling; anything longer keeps
	// dead entries around for no benefit.
	authFailureIdleTTL = 10 * time.Minute
	// How often the map is swept for forgettable entries. Sweeping runs on
	// the failure path only, so a stack that is never attacked never sweeps.
	authFailureSweepEvery = time.Minute
	// Hard ceiling on tracked IPs, so an attacker rotating source addresses
	// (trivial over IPv6) cannot grow the map without bound. At the cap the
	// least recently seen entries are dropped first.
	authFailureMaxKeys = 10_000
)

// failureBucket is one IP's token bucket. tokens is a float because the refill
// is continuous; lastSeen is the instant tokens was last brought up to date.
type failureBucket struct {
	tokens   float64
	lastSeen time.Time
}

// failureLimiter is a per-key token bucket with bounded memory. Every method
// takes the current time so the behaviour is testable without sleeping.
type failureLimiter struct {
	mu      sync.Mutex
	buckets map[string]*failureBucket

	burst   float64       // bucket capacity, in tokens
	refill  float64       // tokens per second
	idleTTL time.Duration // how long a full bucket is remembered
	maxKeys int

	lastSweep time.Time
}

func newFailureLimiter() *failureLimiter {
	return newFailureLimiterWith(authFailureBurst, authFailurePerMinute, authFailureIdleTTL, authFailureMaxKeys)
}

func newFailureLimiterWith(burst, perMinute int, idleTTL time.Duration, maxKeys int) *failureLimiter {
	return &failureLimiter{
		buckets: make(map[string]*failureBucket),
		burst:   float64(burst),
		refill:  float64(perMinute) / 60,
		idleTTL: idleTTL,
		maxKeys: maxKeys,
	}
}

// refillLocked brings one bucket up to date. Callers hold l.mu.
func (l *failureLimiter) refillLocked(b *failureBucket, now time.Time) {
	if elapsed := now.Sub(b.lastSeen); elapsed > 0 {
		b.tokens += elapsed.Seconds() * l.refill
		if b.tokens > l.burst {
			b.tokens = l.burst
		}
	}
	b.lastSeen = now
}

// allow reports whether an authentication attempt from key may be evaluated at
// all, and — when it may not — how long the caller should wait. An unknown key
// is always allowed and is deliberately not recorded: only failures create
// entries, so ordinary traffic from many addresses costs no memory.
func (l *failureLimiter) allow(key string, now time.Time) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()

	b, ok := l.buckets[key]
	if !ok {
		return true, 0
	}
	l.refillLocked(b, now)
	if b.tokens >= 1 {
		return true, 0
	}
	// Time until the bucket holds one whole token again, rounded up so a
	// client that obeys Retry-After is not refused a second time.
	wait := time.Duration((1-b.tokens)/l.refill*float64(time.Second)) + time.Second
	return false, wait.Round(time.Second)
}

// recordFailure charges one token to key. Buckets are created full, so the
// first failure from a quiet address costs nothing but a map entry.
func (l *failureLimiter) recordFailure(key string, now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()

	b, ok := l.buckets[key]
	if !ok {
		l.sweepLocked(now)
		b = &failureBucket{tokens: l.burst, lastSeen: now}
		l.buckets[key] = b
	} else {
		l.refillLocked(b, now)
	}
	b.tokens--
	if b.tokens < 0 {
		b.tokens = 0
	}
}

// sweepLocked bounds the map: it forgets buckets that have refilled completely
// and have been idle past the TTL, then, if the cap is still exceeded, drops
// the least recently seen entries. Callers hold l.mu.
func (l *failureLimiter) sweepLocked(now time.Time) {
	if now.Sub(l.lastSweep) < authFailureSweepEvery && len(l.buckets) < l.maxKeys {
		return
	}
	l.lastSweep = now

	for key, b := range l.buckets {
		refilled := b.tokens + now.Sub(b.lastSeen).Seconds()*l.refill
		if refilled >= l.burst && now.Sub(b.lastSeen) > l.idleTTL {
			delete(l.buckets, key)
		}
	}
	if len(l.buckets) < l.maxKeys {
		return
	}
	keys := make([]string, 0, len(l.buckets))
	for key := range l.buckets {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		return l.buckets[keys[i]].lastSeen.Before(l.buckets[keys[j]].lastSeen)
	})
	// Drop a quarter of the table so this does not run on every failure.
	for _, key := range keys[:len(keys)-l.maxKeys*3/4] {
		delete(l.buckets, key)
	}
}

// size is the number of tracked addresses (tests and diagnostics).
func (l *failureLimiter) size() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.buckets)
}

// clientIP is the address a rate-limit bucket is keyed on.
//
// RemoteAddr is the only value the server observes for itself, so it is the
// default. X-Forwarded-For is attacker-controlled — anyone can send one — and
// trusting it blindly would hand out a fresh bucket per request. It is honoured
// only when TRUST_PROXY_HEADERS=true says a proxy that overwrites the header
// (a reverse proxy, Tailscale Serve/Funnel) is the only thing that can reach
// this port, in which case the FIRST entry is the original client.
func clientIP(r *http.Request, trustProxyHeaders bool) string {
	if trustProxyHeaders {
		if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
			if first := strings.TrimSpace(strings.Split(forwarded, ",")[0]); first != "" {
				return first
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		// Not host:port (a unix socket, or a test harness): key on it whole.
		return r.RemoteAddr
	}
	return host
}
