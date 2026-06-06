import { DesignLab } from "../../../components/DesignLab";

export const metadata = {
  title: "Device Flow | CodexNext Design Lab",
  description: "Device naming, connection, and project folder selection states."
};

export default function DeviceDesignPage() {
  return <DesignLab flow="device-flow" initialState="device" />;
}
