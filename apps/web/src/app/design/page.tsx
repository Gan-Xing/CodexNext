import { DesignLab } from "../../components/DesignLab";

export const metadata = {
  title: "CodexNext Design Lab",
  description: "Long-running interactive design system for CodexNext."
};

export default function DesignPage() {
  return <DesignLab flow="current" />;
}
