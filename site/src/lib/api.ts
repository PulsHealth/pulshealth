import fs from "fs/promises";
import path from "path";
import yaml from "js-yaml";
import { HealthKitType, SearchItem } from "./types";
import { getAllPosts } from "./blog";
import { STATIC_PAGES } from "./pages";

// Points to the knowledge-base directory containing the YAML content files
const CONTENT_DIR = path.join(process.cwd(), "..", "knowledge-base");

// Module-level cache for parsed YAML files
let typesCache: HealthKitType[] | null = null;

async function getFilesRecursively(dir: string): Promise<string[]> {
  let results: string[] = [];

  try {
    const list = await fs.readdir(dir);
    for (const file of list) {
      const filePath = path.join(dir, file);
      const stat = await fs.stat(filePath);
      if (stat && stat.isDirectory()) {
        results = results.concat(await getFilesRecursively(filePath));
      } else {
        results.push(filePath);
      }
    }
  } catch {
    // Directory doesn't exist or isn't accessible
    return [];
  }

  return results;
}

export async function getAllTypes(): Promise<HealthKitType[]> {
  // Return cached results if available
  if (typesCache !== null) {
    return typesCache;
  }

  const types: HealthKitType[] = [];

  try {
    // Check if directory exists
    try {
      await fs.access(CONTENT_DIR);
    } catch {
      console.error(`Content dir not found: ${CONTENT_DIR}`);
      return [];
    }

    const entries = await getFilesRecursively(CONTENT_DIR);

    // Process files in parallel for better performance
    const parsePromises = entries
      .filter(
        (entry) => entry.endsWith(".yaml") && !entry.endsWith("schema.yaml")
      )
      .map(async (entry) => {
        try {
          const fileContent = await fs.readFile(entry, "utf8");
          const data = yaml.load(fileContent) as Omit<
            HealthKitType,
            "slug" | "path"
          >;
          if (data && data.identifier) {
            return {
              ...data,
              slug: data.identifier,
              path: path.relative(CONTENT_DIR, entry),
            } as HealthKitType;
          }
        } catch (e) {
          console.error(`Error parsing ${entry}`, e);
        }
        return null;
      });

    const results = await Promise.all(parsePromises);
    types.push(...results.filter((t): t is HealthKitType => t !== null));
  } catch (error) {
    console.error("Error reading directory", error);
  }

  // Cache the results
  typesCache = types;
  return types;
}

export async function getTypeById(
  identifier: string
): Promise<HealthKitType | undefined> {
  const all = await getAllTypes();
  return all.find((t) => t.identifier === identifier);
}

export async function getAllSearchItems(): Promise<SearchItem[]> {
  const [types, posts] = await Promise.all([getAllTypes(), getAllPosts()]);

  // Convert blog posts to search items
  const blogItems: SearchItem[] = posts.map((post) => ({
    id: `blog-${post.slug}`,
    type: "blog" as const,
    title: post.title,
    description: post.excerpt,
    href: `/blog/${post.slug}`,
    icon: "Newspaper",
    tags: post.tags,
  }));

  // Convert healthkit types to search items
  const healthkitItems: SearchItem[] = types.map((t) => ({
    id: `healthkit-${t.identifier}`,
    type: "healthkit" as const,
    title: t.human_readable_name,
    description: t.short_description,
    href: `/knowledge-base/types/${t.identifier}`,
    icon: t.icon ?? undefined,
    color: t.color ?? undefined,
    category: t.category,
  }));

  // Return combined: pages first, then blog, then healthkit
  return [...STATIC_PAGES, ...blogItems, ...healthkitItems];
}
