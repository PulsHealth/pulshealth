import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadPosts } from "../src/lib/blog";
import { serializeJsonLd } from "../src/lib/json-ld";
import { syncBlogImages } from "../scripts/blog-images";
import { checkBlogExport, checkLocalLinks } from "../scripts/check-export";

function fixture(run: (root: string, articlesDir: string) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "puls-blog-test-"));
  const articlesDir = path.join(root, "blog/articles");
  fs.mkdirSync(articlesDir, { recursive: true });
  fs.mkdirSync(path.join(root, "blog/images"));
  fs.mkdirSync(path.join(root, "site"));
  try { run(root, articlesDir); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function article(dir: string, metadata = '', name = "example.mdx") {
  fs.writeFileSync(path.join(dir, name), `---\ntitle: Example\ndate: "2026-01-01"\nexcerpt: A useful example.\n${metadata}\n---\nBody.`);
}

test("drafts are excluded by default, but available for preview without publication metadata", () => fixture((_root, dir) => {
  article(dir);
  fs.writeFileSync(path.join(dir, "unfinished.mdx"), '---\ntitle: Unfinished\ndraft: true\n---\n<Unfinished');
  assert.deepEqual(loadPosts({ articlesDir: dir }).map(post => post.slug), ["example"]);
  assert.deepEqual(loadPosts({ articlesDir: dir, includeDrafts: true }).map(post => post.slug), ["unfinished", "example"]);
}));

test("a broken file reports its filename instead of returning a partial list", () => fixture((_root, dir) => {
  article(dir, '', "a-good.mdx");
  fs.writeFileSync(path.join(dir, "b-broken.mdx"), '---\ntitle: [bad\n---\nBody');
  article(dir, '', "c-good.mdx");
  assert.throws(() => loadPosts({ articlesDir: dir }), /b-broken\.mdx/);
}));

test("missing content directories and duplicate slugs fail", () => fixture((_root, dir) => {
  assert.throws(() => loadPosts({ articlesDir: path.join(dir, "missing") }), /directory not found/);
  article(dir);
  article(dir, '', "example.md");
  assert.throws(() => loadPosts({ articlesDir: dir }), /duplicate slug/);
}));

for (const [metadata, message] of [
  ['tags: apple-watch', /tags must be an array/],
  ['draft: "true"', /draft must be/],
  ['drfat: true', /unknown metadata/],
  ['updated: "2025-12-31"', /cannot precede/],
  ['featured_image: javascript:alert(1)', /featured_image must be/],
] as const) {
  test(`reject invalid metadata: ${metadata}`, () => fixture((_root, dir) => {
    article(dir, metadata);
    assert.throws(() => loadPosts({ articlesDir: dir }), message);
  }));
}

test("publication needs an explicit real date and excerpt", () => fixture((_root, dir) => {
  for (const metadata of ['title: Example', 'title: Example\ndate: "2026-02-30"\nexcerpt: Example', 'title: Example\ndate: "2026-01-01"', 'title: Example\ndate: 2026-01-01\nexcerpt: Example']) {
    fs.writeFileSync(path.join(dir, "example.mdx"), `---\n${metadata}\n---\nBody`);
    assert.throws(() => loadPosts({ articlesDir: dir }), /example\.mdx/);
  }
}));

test("future dates cannot silently publish; drafts can hold them", () => fixture((_root, dir) => {
  fs.writeFileSync(path.join(dir, "example.mdx"), '---\ntitle: Example\ndate: "2099-01-01"\nexcerpt: Example\n---\nBody');
  assert.throws(() => loadPosts({ articlesDir: dir, today: "2026-10-07" }), /in the future/);
  article(dir, 'draft: true\nupdated: "2099-01-01"');
  assert.equal(loadPosts({ articlesDir: dir, includeDrafts: true })[0].draft, true);
}));

test("image sync removes stale files, omits draft/orphan assets, and includes preview assets", () => fixture((root, dir) => {
  article(dir);
  article(dir, 'draft: true', 'unfinished.mdx');
  for (const slug of ['example', 'unfinished', 'orphan']) {
    const images = path.join(root, 'blog/images', slug);
    fs.mkdirSync(images);
    fs.writeFileSync(path.join(images, 'figure.webp'), 'image');
  }
  const siteDir = path.join(root, 'site');
  syncBlogImages({ siteDir, includeDrafts: true });
  assert.ok(fs.existsSync(path.join(siteDir, 'public/blog/unfinished/figure.webp')));
  fs.writeFileSync(path.join(siteDir, 'public/blog/stale.webp'), 'stale');
  syncBlogImages({ siteDir });
  assert.deepEqual(fs.readdirSync(path.join(siteDir, 'public/blog')), ['example']);
  fs.unlinkSync(path.join(root, 'blog/images/example/figure.webp'));
  syncBlogImages({ siteDir });
  assert.ok(!fs.existsSync(path.join(siteDir, 'public/blog/example/figure.webp')));
}));

test("local checks cover images, relative links, same-origin URLs and fragments", () => fixture((root) => {
  fs.mkdirSync(path.join(root, 'docs/example'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/example/index.html'), '<h2 id="section">Example</h2>');
  checkLocalLinks('<a href="../../docs/example/#section">Read</a>', '/blog/example/', root);
  assert.throws(() => checkLocalLinks('<img src="/missing.webp"/>', '/blog/example/', root), /missing file/);
  assert.throws(() => checkLocalLinks('<meta property="og:image" content="https://pulshealth.com/missing.webp"/>', '/blog/example/', root), /missing file/);
  assert.throws(() => checkLocalLinks('<a href="https://pulshealth.com/docs/example/#missing">Read</a>', '/blog/example/', root), /missing anchor/);
  checkLocalLinks('<script>"<img src=\'/fake.webp\'>"</script><a href="https://example.com/">External</a>', '/blog/example/', root);
}));

test("export checks reject absent pages, draft assets and discovery leaks", () => fixture((root, dir) => {
  article(dir);
  article(dir, 'draft: true', 'unfinished.mdx');
  const posts = loadPosts({ articlesDir: dir, includeDrafts: true });
  const out = path.join(root, 'out');
  fs.mkdirSync(path.join(out, 'blog/example'), { recursive: true });
  fs.writeFileSync(path.join(out, 'blog/index.html'), '<h1>Blog</h1>');
  fs.writeFileSync(path.join(out, 'blog/example/index.html'), '<h1>Example</h1>');
  const url = 'https://pulshealth.com/blog/example/';
  fs.writeFileSync(path.join(out, 'feed.xml'), `<rss><item><link>${url}</link></item></rss>`);
  fs.writeFileSync(path.join(out, 'sitemap.xml'), `<urlset><url><loc>${url}</loc></url></urlset>`);
  const search = [{ type: 'blog', href: '/blog/example' }];
  fs.writeFileSync(path.join(out, 'search-index.json'), JSON.stringify(search));
  checkBlogExport(out, posts);
  fs.mkdirSync(path.join(out, 'blog/unfinished'));
  assert.throws(() => checkBlogExport(out, posts), /Draft page or images leaked/);
  fs.rmdirSync(path.join(out, 'blog/unfinished'));
  for (const artifact of ['feed.xml', 'sitemap.xml', 'search-index.json']) {
    const file = path.join(out, artifact);
    const previous = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, previous.replaceAll('example', 'unfinished'));
    assert.throws(() => checkBlogExport(out, posts), /entries/);
    fs.writeFileSync(file, previous);
  }
  fs.unlinkSync(path.join(out, 'blog/example/index.html'));
  assert.throws(() => checkBlogExport(out, posts), /Blog pages/);
}));

test("JSON-LD cannot close its script element and preserves its data", () => {
  const payload = { description: '</script><script>alert("example")</script>' };
  const serialized = serializeJsonLd(payload);
  assert.ok(!serialized.includes('<'));
  assert.deepEqual(JSON.parse(serialized), payload);
});
