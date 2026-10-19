import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Environment, SignedDataVerifier } from "@apple/app-store-server-library";

const verifiers = new Map<boolean, SignedDataVerifier>();
export function verifierFor(sandbox: boolean): SignedDataVerifier {
  let verifier = verifiers.get(sandbox);
  if (!verifier) {
    // Public trust roots, downloaded from Apple's certificate authority.
    const roots = ["AppleIncRootCertificate.cer", "AppleRootCA-G2.cer", "AppleRootCA-G3.cer"]
      .map(name => readFileSync(join(process.cwd(), "certificates/apple", name)));
    verifier = new SignedDataVerifier(roots, true, sandbox ? Environment.SANDBOX : Environment.PRODUCTION,
      "com.pulsHealth.PulsHealth", 6757657354);
    verifiers.set(sandbox, verifier);
  }
  return verifier;
}
