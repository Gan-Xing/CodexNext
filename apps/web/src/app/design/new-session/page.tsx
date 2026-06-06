import { DesignLab } from "../../../components/DesignLab";

export const metadata = {
  title: "New Session Flow | CodexNext Design Lab",
  description: "New conversation, project, permission, model, and send states."
};

export default function NewSessionDesignPage() {
  return <DesignLab flow="new-session" initialState="empty" />;
}
