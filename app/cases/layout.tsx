import Sidebar from "@/components/Sidebar";

export default function CasesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex">
      <Sidebar />
      {children}
    </div>
  );
}
