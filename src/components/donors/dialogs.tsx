"use client";

// Client wrappers around <Modal> so Server Components can render them with serializable props only.

import { Pencil, Plus } from "lucide-react";
import { Modal } from "@/components/ui/client";
import type { Campaign } from "@/lib/types";
import { CampaignForm } from "./campaign-form";
import { DonationForm } from "./donation-form";

export function AddDonationDialog({ campaigns, today, defaultCampaign, variant = "primary" }: {
  campaigns: { id: number; name: string }[]; today: string; defaultCampaign?: number; variant?: "primary" | "secondary";
}) {
  return (
    <Modal trigger={<><Plus className="size-4" aria-hidden />רישום תרומה</>} title="רישום תרומה" triggerVariant={variant} triggerSize="sm" wide>
      {(close) => <DonationForm campaigns={campaigns} today={today} defaultCampaign={defaultCampaign} onDone={close} />}
    </Modal>
  );
}

export function CampaignDialog({ campaign }: { campaign?: Campaign }) {
  return (
    <Modal
      trigger={campaign ? <><Pencil className="size-4" aria-hidden />עריכה<span className="sr-only"> של {campaign.name}</span></> : <><Plus className="size-4" aria-hidden />קמפיין חדש</>}
      title={campaign ? `עריכת ${campaign.name}` : "קמפיין חדש"}
      triggerVariant={campaign ? "ghost" : "primary"}
      triggerSize="sm"
    >
      {(close) => <CampaignForm campaign={campaign} onDone={close} />}
    </Modal>
  );
}
