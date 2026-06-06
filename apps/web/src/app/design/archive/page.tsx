import { DesignLab } from "../../../components/DesignLab";

export const metadata = {
  title: "Archive | CodexNext Design Lab",
  description: "Archived explorations and retired design artifacts."
};

export default function ArchiveDesignPage() {
  return <DesignLab flow="archive" initialState="empty" />;
}
