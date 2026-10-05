# RAKSHA: Records and Access Knowledge System for Secure Handling & Archives

RAKSHA is an advanced, classified workspace designed for the secure handling, auditing, and management of sensitive investigative documents, forensic evidence, and judicial packages. 

It provides an immutable chain of custody, deep role-based access control (RBAC), row-level security (RLS), and a modern AI-assisted interface for rapid evidence processing.

## 🚀 Key Features

*   **Secure Document Management:** Controlled document versions, classification tiers, and state machine workflows (Draft -> Under Review -> Approved -> Sealed).
*   **Immutable Chain of Custody:** Cryptographic auditing with SHA-256 hashes applied to all evidence, artifacts, and judicial packages.
*   **Deep Role-Based Access Control:** Granular access provisioning across 7 specialized roles (Administrators, Police Officers, Supervisors, Forensic Analysts, Reviewers, Prosecutors, and Judicial Users).
*   **Forensic Workflows:** Built-in forensic request tracking, findings documentation, and peer review systems.
*   **AI Case Assistant:** Evidence intelligence graph mapping and dynamic question-answering based securely on classified context (RAG).
*   **Court Packages:** Packaged and cryptographically sealed bundles for judicial submission.

## 🛠 Technology Stack

*   **Frontend:** Next.js (React), Tailwind CSS, TypeScript
*   **Backend:** FastAPI (Python), SQLAlchemy, Alembic, Pydantic
*   **Database:** PostgreSQL (with Row-Level Security for multi-tenant isolation)
*   **Security:** JWT Authentication, Argon2 password hashing, RLS, SHA-256 integrity logs.

## 👥 Prototype Accounts

For demonstration and prototype testing, the following pre-configured fictional accounts are available. All accounts share the same password.

*   **Shared Password:** `DevOnly#2026`

**Accounts by Role:**
*   **System Admin:** `demo_admin`
*   **Police Officers:** `officer1`, `officer2`, `officer3`, `officer4`
*   **Police Supervisors:** `supervisor1`, `supervisor2`
*   **Forensic Analysts:** `forensic1`
*   **Forensic Reviewers:** `forensic_reviewer1`
*   **Prosecutors:** `prosecutor1`
*   **Judicial Users:** `judicial1`

## 📦 Local Development Setup

### 1. Database
Ensure you have a PostgreSQL database running.

### 2. Backend API
```bash
cd backend
python -m venv venv
# Activate virtual environment (Windows)
.\venv\Scripts\activate
# Install requirements
pip install -r requirements.txt
# Set environment variables
set DATABASE_URL="postgresql://user:pass@localhost:5432/dbname"
set SECRET_KEY="local-secret-key"
# Run migrations and seed data
alembic upgrade head
python scripts/seed.py
# Start the server
uvicorn app.main:app --reload
```

### 3. Frontend Web App
```bash
cd frontend
# Install dependencies
npm install
# Set environment variable pointing to the backend
set NEXT_PUBLIC_API_URL="http://127.0.0.1:8000"
# Start the development server
npm run dev
```

## 🔒 Security Notice

This repository contains development configurations. **Never** use the demo accounts, hardcoded secrets, or development configurations in a production environment. 

---
*Built for SIH26*
