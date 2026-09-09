import { getAllPosts } from "@/lib/blog";
import Link from "next/link";
import { ArrowRight, Calendar } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata = {
  title: "Blog | PulsHealth",
  description: "Insights on health data, wearables, and the science of personal health tracking.",
  alternates: {
    canonical: '/blog/',
  },
};

export default async function BlogPage() {
  const posts = await getAllPosts();

  return (
    <main className="flex min-h-screen flex-col items-center relative">
      {/* Hero Section */}
      <div className="w-full bg-gradient-to-b from-white to-zinc-50 dark:from-zinc-950 dark:to-zinc-900 pt-20 pb-16 border-b">
        <div className="container mx-auto max-w-7xl px-4 flex flex-col items-center text-center space-y-6">
          <Badge variant="outline" className="px-4 py-1 text-sm rounded-full border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 backdrop-blur-sm">
            PulsHealth Blog
          </Badge>

          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 max-w-3xl">
            Health Data <span className="text-brand">Insights</span>
          </h1>

          <p className="text-lg text-zinc-500 max-w-2xl leading-relaxed">
            Deep dives into wearable metrics, the science behind health tracking, and how to make sense of your data.
          </p>
        </div>
      </div>

      {/* Posts Grid */}
      <div className="container mx-auto max-w-7xl px-4 py-16">
        {posts.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-zinc-500">No posts yet. Check back soon!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {posts.map((post) => (
              <Link key={post.slug} href={`/blog/${post.slug}`} className="group">
                <Card className="h-full transition-all duration-200 hover:border-brand/30 hover:shadow-lg flex flex-col">
                  <CardHeader className="flex-1">
                    <CardTitle className="text-xl leading-snug group-hover:text-brand transition-colors">
                      {post.title}
                    </CardTitle>
                    <CardDescription className="mt-2 line-clamp-3">
                      {post.excerpt}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex items-center gap-4 text-sm text-zinc-500 mb-4">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        {new Date(post.date).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                    </div>
                    <div className="text-sm text-brand flex items-center font-medium opacity-0 group-hover:opacity-100 transition-all duration-200 translate-x-[-10px] group-hover:translate-x-0">
                      Read article <ArrowRight className="ml-1 h-4 w-4" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
