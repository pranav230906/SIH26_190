const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrator",
  POLICE_OFFICER: "Police officer",
  POLICE_SUPERVISOR: "Police supervisor",
  FORENSIC_EXAMINER: "Forensic examiner",
  FORENSIC_REVIEWER: "Forensic reviewer",
  PROSECUTOR: "Prosecutor",
  JUDICIAL_USER: "Judicial user",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  UNDER_INVESTIGATION: "Under investigation",
  UNDER_REVIEW: "Under review",
  READY_FOR_PROSECUTION: "Ready for prosecution",
  IN_COURT: "In court",
  CLOSED: "Closed",
  ARCHIVED: "Archived",
};

const TYPE_LABELS: Record<string, string> = {
  CRIMINAL: "Criminal",
  CIVIL: "Civil",
  FORENSIC: "Forensic",
  ADMINISTRATIVE: "Administrative",
};

export function roleLabel(name: string): string {
  return ROLE_LABELS[name] ?? name;
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function caseTypeLabel(caseType: string): string {
  return TYPE_LABELS[caseType] ?? caseType;
}

const ASSIGNMENT_LABELS: Record<string, string> = {
  PRIMARY_OFFICER: "Primary officer",
  SUPERVISOR: "Supervisor",
  FORENSIC_EXAMINER: "Forensic examiner",
  FORENSIC_REVIEWER: "Forensic reviewer",
  PROSECUTOR: "Prosecutor",
  JUDICIAL_ACCESS: "Judicial access",
};

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  FIR: "FIR",
  POLICE_REPORT: "Police report",
  INVESTIGATION_RECORD: "Investigation record",
  WITNESS_STATEMENT: "Witness statement",
  CHARGE_SHEET: "Charge sheet",
  COURT_FILING: "Court filing",
  EVIDENCE_RECORD: "Evidence record",
  FORENSIC_REPORT: "Forensic report",
  LEGAL_NOTICE: "Legal notice",
  JUDGMENT: "Judgment",
  CASE_DIARY: "Case diary",
  OTHER: "Other",
};

const DOCUMENT_CLASSIFICATION_LABELS: Record<string, string> = {
  INTERNAL: "Internal",
  CONFIDENTIAL: "Confidential",
  HIGHLY_CONFIDENTIAL: "Highly confidential",
  RESTRICTED: "Restricted",
};

const DOCUMENT_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  UNDER_REVIEW: "Under review",
  APPROVED: "Approved",
  SEALED: "Sealed",
  ARCHIVED: "Archived",
};

export function documentTypeLabel(value: string): string {
  return DOCUMENT_TYPE_LABELS[value] ?? value;
}

export function documentClassificationLabel(value: string): string {
  return DOCUMENT_CLASSIFICATION_LABELS[value] ?? value;
}

export function documentStatusLabel(value: string): string {
  return DOCUMENT_STATUS_LABELS[value] ?? value;
}

const EVIDENCE_TYPE_LABELS: Record<string, string> = {
  CCTV_VIDEO: "CCTV video",
  AUDIO_RECORDING: "Audio recording",
  PHOTOGRAPH: "Photograph",
  MOBILE_DUMP: "Mobile dump",
  DISK_IMAGE: "Disk image",
  DOCUMENT: "Document",
  SCREENSHOT: "Screenshot",
  DIGITAL_FILE: "Digital file",
  FORENSIC_IMAGE: "Forensic image",
  OTHER: "Other",
};

const EVIDENCE_STATUS_LABELS: Record<string, string> = {
  RECEIVED: "Received",
  VERIFIED: "Verified",
  SEALED: "Sealed",
  ARCHIVED: "Archived",
};

const ARTIFACT_TYPE_LABELS: Record<string, string> = {
  VIDEO_CLIP: "Video clip",
  IMAGE_CROP: "Image crop",
  ENHANCED_IMAGE: "Enhanced image",
  AUDIO_EXTRACTION: "Audio extraction",
  CONVERTED_FILE: "Converted file",
  SCREENSHOT: "Screenshot",
  TEXT_EXTRACTION: "Text extraction",
  ANNOTATION: "Annotation",
  FORENSIC_OUTPUT: "Forensic output",
  OTHER: "Other",
};

export function evidenceTypeLabel(value: string): string {
  return EVIDENCE_TYPE_LABELS[value] ?? value;
}

export function evidenceStatusLabel(value: string): string {
  return EVIDENCE_STATUS_LABELS[value] ?? value;
}

export function artifactTypeLabel(value: string): string {
  return ARTIFACT_TYPE_LABELS[value] ?? value;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "Unknown size";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function assignmentLabel(value: string): string {
  return ASSIGNMENT_LABELS[value] ?? value;
}

const FORENSIC_TYPE_LABELS: Record<string, string> = {
  DIGITAL_FORENSICS: "Digital forensics",
  VIDEO_ANALYSIS: "Video analysis",
  IMAGE_ANALYSIS: "Image analysis",
  AUDIO_ANALYSIS: "Audio analysis",
  MOBILE_FORENSICS: "Mobile forensics",
  DISK_FORENSICS: "Disk forensics",
  DOCUMENT_FORENSICS: "Document forensics",
  OTHER: "Other",
};

const FORENSIC_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  SUBMITTED_FOR_REVIEW: "Submitted for review",
  COMPLETED: "Completed",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

const CUSTODY_LABELS: Record<string, string> = {
  EVIDENCE_UPLOADED: "Evidence uploaded",
  EVIDENCE_VERIFIED: "Integrity verified",
  EVIDENCE_ACCESSED: "Evidence accessed",
  EVIDENCE_DOWNLOADED: "Evidence downloaded",
  FORENSIC_REQUEST_CREATED: "Forensic examination requested",
  FORENSIC_REQUEST_APPROVED: "Examination approved",
  FORENSIC_REQUEST_ASSIGNED: "Assigned to forensic examiner",
  FORENSIC_ANALYSIS_STARTED: "Analysis started",
  DERIVED_ARTIFACT_CREATED: "Derived artifact created",
  FORENSIC_REVIEW_SUBMITTED: "Submitted for review",
  FORENSIC_REVIEW_ACCEPTED: "Forensic review accepted",
  FORENSIC_REVIEW_RETURNED: "Returned for correction",
  EVIDENCE_SEALED: "Evidence sealed",
};

const VERSION_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED_FOR_REVIEW: "Submitted for review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SUPERSEDED: "Superseded",
};

export function versionStatusLabel(value: string): string {
  return VERSION_STATUS_LABELS[value] ?? value;
}

export function forensicTypeLabel(value: string): string {
  return FORENSIC_TYPE_LABELS[value] ?? value;
}

export function forensicStatusLabel(value: string): string {
  return FORENSIC_STATUS_LABELS[value] ?? value;
}

export function custodyEventLabel(value: string): string {
  return CUSTODY_LABELS[value] ?? value;
}

export function formatDay(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date);
}

export function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
