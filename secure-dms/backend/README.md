# Secure DMS backend

Case-centric API for the demonstration document system. This service authenticates users, authorizes case work, stores documents and evidence, and builds court packages the court can verify.

Passwords are hashed with Argon2. Access and refresh tokens are JWTs signed with secrets from the environment. Refresh tokens are stored only as SHA-256 hashes so logout can revoke them. The API never returns `password_hash`.

Use fictional data only.

## Requirements

- Python 3.11+
- PostgreSQL 14+ (this workspace was verified with PostgreSQL 18)

## Setup

From `secure-dms/backend`:

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `.env`. Replace both JWT placeholders with long random values:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

`JWT_SECRET_KEY` and `JWT_REFRESH_SECRET_KEY` must be different, at least 32 characters, and must not start with `change-me`.

## Database

Create a role and database with a PostgreSQL superuser, then point `DATABASE_URL` at them:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h 127.0.0.1 -d postgres -c "CREATE USER secure_dms WITH PASSWORD 'choose-a-password';"
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h 127.0.0.1 -d postgres -c "CREATE DATABASE secure_dms OWNER secure_dms;"
```

If the Windows PostgreSQL service is already installed but its superuser password is unknown, a separate local cluster can be used instead. This workspace verified the API against a cluster at `%LOCALAPPDATA%\secure-dms-pg` on port **5433**. Start that cluster with:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe" -D "$env:LOCALAPPDATA\secure-dms-pg" -l "$env:LOCALAPPDATA\secure-dms-pg\server.log" start
```

`DATABASE_URL` looks like:

```text
postgresql+psycopg://secure_dms:choose-a-password@127.0.0.1:5432/secure_dms
```

Apply the schema and load fictional development accounts:

```powershell
.\venv\Scripts\alembic.exe upgrade head
.\venv\Scripts\python.exe -m scripts.reset_demo
.\venv\Scripts\python.exe -m scripts.seed
```

The seed script prints the shared development password. Those accounts are for local demonstration only.

To reset and re-seed the demo dataset safely without dropping tables:
```powershell
.\venv\Scripts\python.exe -m scripts.reset_demo
.\venv\Scripts\python.exe -m scripts.seed
```

## Run

```powershell
.\venv\Scripts\uvicorn.exe app.main:app --reload --host 127.0.0.1 --port 8000
```

Interactive API docs: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

Health check: [http://127.0.0.1:8000/api/health](http://127.0.0.1:8000/api/health)

Uploaded files are stored under `backend/storage/cases/{case number}/documents/`. The stored name is a generated id. The original filename is metadata only. `MAX_UPLOAD_SIZE_MB` defaults to 25 when it is omitted from `.env`.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/login` | Exchange username and password for access and refresh tokens |
| POST | `/api/auth/refresh` | Rotate a refresh token |
| POST | `/api/auth/logout` | Revoke a refresh token |
| GET | `/api/auth/me` | Current user, role, department, and assigned case ids |
| GET | `/api/auth/permissions` | Role and permission codes for the interface only |
| GET | `/api/users` | List users (`USER.READ`) |
| POST | `/api/users` | Create an account (`USER.CREATE`, administrator only). The password is stored as a hash and is not returned |
| GET | `/api/users/directory` | Active users for assignment (`CASE.ASSIGN` or `USER.READ`) |
| GET | `/api/users/{user_id}` | Read one user (self, or `USER.READ`) |
| PATCH | `/api/users/{user_id}` | Change another user's role, department, or active flag (`USER.UPDATE`) |
| GET | `/api/departments` | List departments (`DEPARTMENT.READ`) |
| GET | `/api/cases` | Authorized cases only. Filters: `status`, `case_type`, `department_id`, `q`, `page`, `page_size` |
| POST | `/api/cases` | Create a case (`CASE.CREATE`). Initial status is Draft or Active. Case number is immutable |
| GET | `/api/cases/{case_key}` | Case detail, participants, and timeline. Hidden cases return 404 |
| PATCH | `/api/cases/{case_key}` | Update permitted metadata (`CASE.UPDATE`). Status changes must follow the lifecycle |
| GET | `/api/cases/{case_key}/assignments` | Active assignments on a visible case |
| POST | `/api/cases/{case_key}/assignments` | Assign another user (`CASE.ASSIGN`). Self-assignment is refused |
| DELETE | `/api/cases/{case_key}/assignments/{assignment_id}` | Deactivate an assignment |
| GET | `/api/cases/{case_key}/access-requests` | Requests on a visible case |
| POST | `/api/cases/{case_key}/access-requests` | Create an access request (`ACCESS_REQUEST.CREATE`) |
| GET | `/api/access-requests?scope=mine` | The caller's own requests |
| GET | `/api/access-requests?scope=pending` | Pending requests the caller may review |
| POST | `/api/access-requests/{request_id}/approve` | Approve another user's request |
| POST | `/api/access-requests/{request_id}/reject` | Reject another user's request |
| POST | `/api/cases/{case_key}/documents` | Upload a document (`DOCUMENT.UPLOAD` or `DOCUMENT.CREATE`) |
| GET | `/api/cases/{case_key}/documents` | Documents on a case the caller may read. Filters: `document_type`, `classification`, `status`, `q` |
| GET | `/api/documents/{document_id}` | Document metadata. Hidden documents return 404 |
| PATCH | `/api/documents/{document_id}` | Metadata only: title, description, classification |
| PATCH | `/api/documents/{document_id}/status` | One allowed lifecycle step |
| GET | `/api/documents/{document_id}/download` | Authorized file stream |
| GET | `/api/documents/{document_id}/preview` | Authorized PDF or image preview |
| DELETE | `/api/documents/{document_id}` | Draft removal for `DOCUMENT.DELETE` only. Official records are refused |
| POST | `/api/cases/{case_key}/evidence` | Store original evidence. The server calculates SHA-256 |
| GET | `/api/cases/{case_key}/evidence` | Evidence the caller may read |
| GET | `/api/evidence/{evidence_id}` | Evidence metadata. Hidden evidence returns 404 |
| GET | `/api/evidence/{evidence_id}/integrity` | Compare the stored file with the recorded SHA-256 |
| GET | `/api/evidence/{evidence_id}/download` | Authorized original stream after an integrity check |
| GET | `/api/evidence/{evidence_id}/provenance` | Original evidence and its derived-artifact tree |
| POST | `/api/evidence/{evidence_id}/verify` | Mark received evidence as verified |
| POST | `/api/evidence/{evidence_id}/seal` | Seal verified evidence |
| POST | `/api/evidence/{evidence_id}/archive` | Archive sealed evidence |
| POST | `/api/evidence/{evidence_id}/artifacts` | Store a derived artifact. The original file is not changed |
| GET | `/api/artifacts/{artifact_id}` | Derived artifact metadata |
| GET | `/api/artifacts/{artifact_id}/integrity` | Compare an artifact file with its recorded SHA-256 |
| GET | `/api/artifacts/{artifact_id}/download` | Authorized artifact stream |
| POST | `/api/artifacts/{artifact_id}/artifacts` | Derive another artifact from an existing artifact |
| GET | `/api/court-packages` | Packages on cases the caller may read |
| POST | `/api/cases/{case_key}/court-packages` | Build a package from records the caller can already read |
| POST | `/api/court-packages/{package_id}/submit` | Seal and submit a draft package |
| POST | `/api/court-packages/{package_id}/verify` | Recompute hashes and report a mismatch. Files are not repaired |
| GET | `/api/health` | Database connectivity check |

Errors use one JSON shape:

```json
{"error": {"code": "unauthorized", "message": "Authentication is required."}}
```

Validation errors add a `details` array. Internal exception text is not returned to clients.

## Authorization

Every protected operation calls `authorize(user, action, resource_type, resource=None, case=None)` in `app/authorization/permission_service.py`. The decision checks the active account, the role's rows in `role_permissions`, case assignment or an approved unexpired access grant, record ownership, and self-approval rules. The administrator permission set covers users, roles, departments, and the audit log. It does not include case, document, or evidence content.

After migration `0011_align`, the API refuses to start until `APP_DATABASE_URL` points at a login that does not own the tables. Create that role, grant it table access, and run `ALTER ROLE secure_dms BYPASSRLS` so migrations and the seed can still use `DATABASE_URL`. New evidence uploads also require `STORAGE_MASTER_KEY`. `APPROVAL_SIGNING_KEY` is optional; without it an approval is stored as unconfigured.

`GET /api/auth/permissions` is for navigation only. The API does not accept those codes as proof of access.

A case the caller cannot open is omitted from lists and returned as `404` with `Case not found.` The same message is used when the case number does not exist.

## Tables

- `roles`
- `departments`
- `users`
- `permissions`
- `role_permissions`
- `cases`
- `case_assignments`
- `case_events` (operational timeline, not the cryptographic audit chain)
- `access_requests` (`resource_id` names a document when the request is document-scoped)
- `documents`
- `evidence`
- `derived_artifacts`
- `evidence_integrity_events` (hash comparisons, not a Merkle audit chain)
- `refresh_tokens` (hashed refresh sessions for logout and rotation)

`case_number` is unique. `permissions` is unique on resource and action. `role_permissions` uses a composite primary key. Assignments stay unique on case, user, and assignment type. A document number is unique within its case.

Original evidence is immutable at the application layer. The local folder is not write-once storage and it is not a legal hold system. The API does not replace, overwrite, or delete an original evidence file. Later processing is stored as a derived artifact that points at the original hash. A hash mismatch is recorded and does not change the stored hash.

Document classification is an extra authorization attribute. `HIGHLY_CONFIDENTIAL` and `RESTRICTED` police documents are visible to an assigned police supervisor. Forensic and court records stay with their owning department. Sealed and archived documents reject ordinary metadata edits. A police officer can update only their own police draft. The file hash is SHA-256 of the original bytes. New evidence files are encrypted when `STORAGE_MASTER_KEY` is set. Existing demonstration files remain unencrypted.
