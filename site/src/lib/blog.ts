import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { BlogPost } from './types';

const ARTICLES_DIR = path.join(process.cwd(), '..', 'blog', 'articles');

export async function getAllPosts(): Promise<BlogPost[]> {
  const posts: BlogPost[] = [];

  try {
    if (!fs.existsSync(ARTICLES_DIR)) {
      console.error(`Articles dir not found: ${ARTICLES_DIR}`);
      return [];
    }

    const files = fs.readdirSync(ARTICLES_DIR);

    for (const file of files) {
      if (file.endsWith('.md') || file.endsWith('.mdx')) {
        // Skip ideas.md as it's not a real article
        if (file === 'ideas.md') continue;

        const filePath = path.join(ARTICLES_DIR, file);
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const { data, content } = matter(fileContent);

        // Validate required frontmatter
        if (!data.title) continue;

        const slug = file.replace(/\.mdx?$/, '');

        posts.push({
          slug,
          title: data.title,
          date: data.date || new Date().toISOString().split('T')[0],
          author: data.author || '',
          tags: data.tags || [],
          excerpt: data.excerpt || content.slice(0, 160).replace(/[#*_]/g, '') + '...',
          content,
          featured_image: data.featured_image,
        });
      }
    }
  } catch (error) {
    console.error('Error reading articles', error);
  }

  // Sort by date descending (newest first)
  return posts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export async function getPostBySlug(slug: string): Promise<BlogPost | undefined> {
  const all = await getAllPosts();
  return all.find((p) => p.slug === slug);
}

export async function getAllTags(): Promise<string[]> {
  const posts = await getAllPosts();
  const tagSet = new Set<string>();
  posts.forEach((post) => post.tags.forEach((tag) => tagSet.add(tag)));
  return Array.from(tagSet).sort();
}
