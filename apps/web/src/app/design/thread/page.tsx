import { DesignLab } from "../../../components/DesignLab";

export const metadata = {
  title: "Thread Flow | CodexNext Design Lab",
  description: "Chat, running turn, steer, and interrupt states."
};

export default function ThreadDesignPage() {
  return <DesignLab flow="thread" initialState="chat" />;
}
