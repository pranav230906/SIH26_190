export type RoleBrief = {
  name: string;
  description: string;
};

export type DepartmentBrief = {
  name: string;
  code: string;
};

export type MeResponse = {
  id: string;
  username: string;
  full_name: string;
  role: RoleBrief;
  department: DepartmentBrief;
  assigned_case_ids: string[];
};

export type TokenResponse = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
};

export type PermissionsResponse = {
  role: string;
  permissions: string[];
};

export type CaseDepartment = {
  id: string;
  name: string;
  code: string;
};

export type CaseSummary = {
  id: string;
  case_number: string;
  title: string;
  case_type: string;
  status: string;
  classification: string;
  department: CaseDepartment | null;
  primary_officer_name: string | null;
  created_at: string;
  updated_at: string;
};

export type CaseParticipant = {
  assignment_id: string;
  user_id: string;
  full_name: string;
  username: string;
  role_name: string;
  department_name: string;
  department_code: string;
  assignment_type: string;
  assigned_at: string;
  active: boolean;
};

export type CaseTimelineEvent = {
  id: string;
  event_type: string;
  message: string;
  occurred_at: string;
};

export type CaseDetail = CaseSummary & {
  description: string;
  created_by: string;
  created_by_name: string;
  participants: CaseParticipant[];
  timeline: CaseTimelineEvent[];
  allowed_status_transitions: string[];
};

export type AssignmentRecord = {
  id: string;
  case_id: string;
  user_id: string;
  username: string;
  full_name: string;
  role_name: string;
  department_name: string;
  department_code: string;
  assignment_type: string;
  assigned_by: string;
  assigned_at: string;
  active: boolean;
};

export type AccessRequestRecord = {
  id: string;
  case_id: string;
  case_number: string;
  requester_id: string;
  requester_username: string;
  resource_type: string;
  resource_id: string | null;
  requested_action: string;
  justification: string;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  expires_at: string | null;
  created_at: string;
  access_kind?: string;
};

export type DocumentSummary = {
  id: string;
  case_id: string;
  document_number: string;
  title: string;
  document_type: string;
  classification: string;
  status: string;
  original_filename: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
  allowed_status_transitions: string[];
};

export type DocumentDetail = DocumentSummary & {
  description: string | null;
  mime_type: string;
  file_size: number;
  file_hash: string;
  hash_algorithm: string;
  created_by: string;
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  sealed_at: string | null;
  archived_at: string | null;
  case_number: string;
  case_title: string;
  official_version_number: number | null;
  official_version_label: string | null;
  search_notice?: string | null;
  owner_department_code?: string | null;
  owner_department_name?: string | null;
  custodian_user_id?: string | null;
  custodian_name?: string | null;
  allowed_actions?: string[];
  security_scan_message?: string | null;
};

export type DocumentVersionSummary = {
  id: string;
  document_id: string;
  version_number: number;
  version_label: string;
  status: string;
  change_summary: string;
  is_official: boolean;
  created_by_name: string;
  created_at: string;
  approved_by_name: string | null;
  approved_at: string | null;
  review_comment: string | null;
  parent_version_id: string | null;
  parent_version_number: number | null;
  sha256_hash: string;
  hash_algorithm: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  allowed_actions: string[];
  seal_algorithm?: string | null;
  seal_value?: string | null;
};

export type DocumentVersionDetail = DocumentVersionSummary & {
  submitted_at: string | null;
  text_excerpt: string | null;
  seal_algorithm: string | null;
  seal_value: string | null;
  security_scan_message?: string | null;
};

export type VersionDiffChange = {
  type: string;
  text: string;
};

export type VersionDiff = {
  parent_version: number | null;
  current_version: number;
  comparable: boolean;
  message: string | null;
  changes: VersionDiffChange[];
};

export type VersionIntegrity = {
  version_id: string;
  algorithm: string;
  stored_hash: string;
  current_hash: string;
  integrity_status: string;
};

export type DocumentListResponse = {
  items: DocumentSummary[];
  total: number;
  page: number;
  page_size: number;
  max_upload_size_mb: number;
};

export type EvidenceSummary = {
  id: string;
  case_id: string;
  evidence_number: string;
  title: string;
  evidence_type: string;
  classification: string;
  status: string;
  sha256_hash: string;
  hash_algorithm: string;
  created_by_name: string;
  created_at: string;
  allowed_actions: string[];
};

export type EvidenceDetail = EvidenceSummary & {
  description: string | null;
  original_filename: string;
  mime_type: string;
  file_size: number;
  created_by: string;
  sealed_at: string | null;
  case_number: string;
  case_title: string;
  last_integrity_status: string | null;
  custodian_user_id?: string | null;
  custodian_name?: string | null;
  security_scan_message?: string | null;
};

export type EvidenceListResponse = {
  items: EvidenceSummary[];
  total: number;
  page: number;
  page_size: number;
  max_upload_size_mb: number;
};

export type IntegrityResult = {
  evidence_id: string | null;
  artifact_id: string | null;
  algorithm: string;
  stored_hash: string;
  current_hash: string;
  integrity_status: string;
};

export type ArtifactSummary = {
  id: string;
  case_id: string;
  source_evidence_id: string;
  source_artifact_id: string | null;
  forensic_request_id?: string | null;
  artifact_number: string;
  title: string;
  description: string | null;
  artifact_type: string;
  processing_description: string;
  classification: string;
  status: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  sha256_hash: string;
  hash_algorithm: string;
  created_by_name: string;
  created_at: string;
  security_scan_message?: string | null;
};

export type ProvenanceNode = {
  id: string;
  artifact_number: string;
  title: string;
  artifact_type: string;
  sha256_hash: string;
  hash_algorithm: string;
  source_artifact_id: string | null;
  created_by_name: string;
  created_at: string;
  children: ProvenanceNode[];
};

export type ProvenanceResponse = {
  evidence_id: string;
  evidence_number: string;
  title: string;
  evidence_type: string;
  sha256_hash: string;
  hash_algorithm: string;
  status: string;
  artifacts: ProvenanceNode[];
};

export type DirectoryUser = {
  id: string;
  username: string;
  full_name: string;
  role_name: string;
  is_active: boolean;
};

export type UserRecord = {
  id: string;
  username: string;
  full_name: string;
  email: string;
  is_active: boolean;
  role: RoleBrief;
  department: DepartmentBrief;
};

export type DepartmentRecord = {
  id: string;
  name: string;
  code: string;
};

export type CaseListResponse = {
  items: CaseSummary[];
  total: number;
  page: number;
  page_size: number;
};

export type ForensicEvidenceRef = {
  id: string;
  evidence_number: string;
  title: string;
  evidence_type: string;
  classification: string;
  status: string;
  sha256_hash: string;
  purpose: string;
  integrity_status: string | null;
};

export type ForensicFinding = {
  id: string;
  finding_number: string;
  title: string;
  description: string;
  finding_type: string;
  status: string;
  created_by_name: string;
  created_at: string;
  artifact_ids: string[];
  artifact_numbers: string[];
};

export type ForensicRequestSummary = {
  id: string;
  case_id: string;
  case_number: string;
  request_number: string;
  request_type: string;
  status: string;
  requested_by_name: string;
  assigned_to_name: string | null;
  evidence_count: number;
  requested_at: string;
  created_at: string;
  allowed_actions: string[];
};

export type ForensicRequestDetail = ForensicRequestSummary & {
  case_title: string;
  reason: string;
  instructions: string;
  requested_by: string;
  assigned_to: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  rejected_at: string | null;
  started_at: string | null;
  submitted_at: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_comment: string | null;
  completed_at: string | null;
  evidence: ForensicEvidenceRef[];
  findings: ForensicFinding[];
  artifacts: ArtifactSummary[];
};

export type CustodyEvent = {
  id: string;
  case_id: string;
  evidence_id: string | null;
  request_id: string | null;
  event_type: string;
  performed_by: string;
  performed_by_name: string;
  performed_at: string;
  description: string;
};

export type SearchResult = {
  type: string;
  case_id: string;
  case_number: string;
  document_id: string | null;
  document_number: string | null;
  version_id: string | null;
  version_label: string | null;
  evidence_id: string | null;
  evidence_number: string | null;
  artifact_id: string | null;
  artifact_number: string | null;
  source_evidence_id: string | null;
  page_number: number | null;
  title: string;
  snippet: string;
  score: number;
  match_type: string;
};

export type SearchResponse = {
  results: SearchResult[];
  total: number;
  mode: string;
  semantic_available: boolean;
  message: string | null;
};

export type SearchSuggestion = {
  label: string;
  kind: string;
  href: string;
};

export type OcrStatus = {
  status: string;
  pages_processed: number;
  total_pages: number;
  extraction_method: string | null;
  error: string | null;
  lexical_status: string;
  semantic_status: string;
  ocr_status: string;
};

export type PageText = {
  document_id: string;
  version_id: string;
  version_label: string;
  page_number: number;
  text: string;
  extraction_method: string;
  status: string;
};

export type RagCaseOption = {
  id: string;
  case_number: string;
  title: string;
};

export type RagCasesResponse = {
  cases: RagCaseOption[];
  provider: string;
  demo_mode: boolean;
};

export type RagCitation = {
  document_id: string | null;
  document_title: string;
  version_id: string | null;
  version_label: string | null;
  page_number: number | null;
  chunk_id: string | null;
  evidence_id: string | null;
  artifact_id: string | null;
  snippet: string;
};

export type RagQueryResponse = {
  conversation_id: string;
  message_id: string;
  case_id: string;
  case_number: string;
  answer: string;
  grounding_status: string;
  demo_mode: boolean;
  provider: string;
  authorized_documents: number;
  retrieved_sources: number;
  citations: RagCitation[];
};

export type RoleRead = {
  id: string;
  name: string;
  description: string;
  permissions: string[];
};

export type RoleListResponse = {
  items: RoleRead[];
  all_permissions: string[];
};

export type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
    details?: { field: string; message: string }[];
  };
};
