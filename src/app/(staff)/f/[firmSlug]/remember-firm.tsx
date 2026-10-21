"use client";

import { useEffect } from "react";
import { rememberFirmAction } from "../../shell-actions";

export function RememberFirm({ firmId }: { firmId: string }) {
  useEffect(() => {
    void rememberFirmAction(firmId);
  }, [firmId]);
  return null;
}
