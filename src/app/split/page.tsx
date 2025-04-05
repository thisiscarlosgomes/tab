"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { SplitJoinDrawer } from "@/components/app/joinSplitDrawer";

export default function SplitLandingPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const handleCreate = () => {
    setIsLoading(true);
    router.push("/split/new");
  };

  return (
    <main className="w-full min-h-screen flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4 mb-4">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold mb-2">Create Group Bill</h1>
          <p className="text-muted text-base">
            Create a shared bill, invite friends, and settle up fast.
          </p>
        </div>

        <Button
          className="w-full bg-primary"
          onClick={handleCreate}
          disabled={isLoading}
        >
          Continue
        </Button>

        <SplitJoinDrawer />
      </div>
    </main>
  );
}
