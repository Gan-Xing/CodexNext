import { DesignLab } from "../../../components/DesignLab";

export const metadata = {
  title: "Components | CodexNext Design Lab",
  description: "Codex-style component and icon registry for CodexNext."
};

export default function ComponentsDesignPage() {
  return <DesignLab flow="components" initialState="empty" />;
}
