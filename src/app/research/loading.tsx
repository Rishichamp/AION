import { SkeletonGrid } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="px-5 py-8 md:px-10 md:py-12">
      <div className="skeleton mb-2 h-8 w-40 rounded" />
      <div className="skeleton mb-6 h-4 w-72 rounded" />
      <SkeletonGrid count={6} />
    </div>
  );
}
