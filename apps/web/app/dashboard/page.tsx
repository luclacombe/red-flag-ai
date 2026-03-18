import { HistoryView } from "@/components/history-view";

export const metadata = {
  title: "Dashboard — RedFlag AI",
  description: "View and manage your past contract analyses.",
};

export default function DashboardPage() {
  return <HistoryView />;
}
