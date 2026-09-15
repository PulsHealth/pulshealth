import dynamic from "next/dynamic";
import { ArrowRight, Github, Mail, Rss } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GITHUB_URL } from "@/lib/github";
import { cn } from "@/lib/utils";

const UpdatesDialog = dynamic(
  () => import("@/components/updates-dialog").then((mod) => mod.UpdatesDialog),
);

/**
 * "Follow the project", shared by the home and iOS pages. Three ways, in the
 * order an open-source visitor expects: watch releases, subscribe to the
 * feed, or leave an email. The email path is the only one that sends the
 * site anything, and the privacy policy's website section says what.
 */
export function FollowProject({ className }: { className?: string }) {
  return (
    <section className={cn("border-t", className)}>
      <div className="container mx-auto max-w-7xl px-4 py-16">
        <div className="mx-auto flex max-w-xl flex-col items-center gap-4 text-center">
          <div className="rounded-xl bg-brand-muted p-3 text-brand">
            <Mail className="h-5 w-5" />
          </div>
          <h2 className="text-xl font-semibold tracking-tight">Follow the project</h2>
          <p className="text-muted-foreground">
            Watch the repository for releases, subscribe to the feed, or leave your email for
            occasional updates.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <Button asChild variant="outline">
              <a href={`${GITHUB_URL}/releases`} target="_blank" rel="noopener noreferrer">
                <Github className="mr-2 h-4 w-4" />
                Releases
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href="/feed.xml">
                <Rss className="mr-2 h-4 w-4" />
                Feed
              </a>
            </Button>
            <UpdatesDialog>
              <Button variant="outline">
                Email updates
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </UpdatesDialog>
          </div>
        </div>
      </div>
    </section>
  );
}
