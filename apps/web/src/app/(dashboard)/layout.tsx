export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="flex h-svh flex-col overflow-hidden">{children}</div>;
}
