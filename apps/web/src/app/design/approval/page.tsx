import { DesignLab } from "../../../components/DesignLab";

export const metadata = {
  title: "Approval Flow | CodexNext Design Lab",
  description: "Approval request handling states for the local web console."
};

export default function ApprovalDesignPage() {
  return <DesignLab flow="approval-flow" initialState="approval" />;
}
