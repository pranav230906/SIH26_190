"""Document ownership, court packages, evidence encryption flags, and row security.

Revision ID: 0011_align
Revises: 0010_audit
Create Date: 2026-09-27

Data updates run before row security is forced.
The table owner needs BYPASSRLS so later migrations and the seed still run.
Create the application login before relying on the API:

    CREATE ROLE secure_dms_app LOGIN PASSWORD '...';
    GRANT CONNECT ON DATABASE secure_dms TO secure_dms_app;
    GRANT USAGE ON SCHEMA public TO secure_dms_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO secure_dms_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO secure_dms_app;
    ALTER ROLE secure_dms BYPASSRLS;

Put that login in APP_DATABASE_URL. Leave DATABASE_URL as the table owner.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0011_align"
down_revision: Union[str, None] = "0010_audit"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("owner_department_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("documents", sa.Column("custodian_user_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_documents_owner_department", "documents", "departments", ["owner_department_id"], ["id"])
    op.create_foreign_key("fk_documents_custodian", "documents", "users", ["custodian_user_id"], ["id"])
    op.add_column(
        "access_requests",
        sa.Column("access_kind", sa.String(length=16), nullable=False, server_default="STANDARD"),
    )
    op.add_column("document_versions", sa.Column("seal_algorithm", sa.String(length=32), nullable=True))
    op.add_column("document_versions", sa.Column("seal_value", sa.String(length=128), nullable=True))
    op.add_column(
        "evidence",
        sa.Column("storage_encrypted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "derived_artifacts",
        sa.Column("storage_encrypted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.execute("UPDATE documents SET document_type = 'INVESTIGATION_RECORD' WHERE document_type = 'OTHER'")
    op.execute(
        """
        UPDATE documents AS document
        SET owner_department_id = department.id
        FROM departments AS department
        WHERE document.owner_department_id IS NULL
          AND department.code = CASE document.document_type
            WHEN 'FORENSIC_REPORT' THEN 'FLS'
            WHEN 'LEGAL_NOTICE' THEN 'PRS'
            WHEN 'COURT_FILING' THEN 'PRS'
            WHEN 'PROSECUTION_SUBMISSION' THEN 'PRS'
            WHEN 'JUDGMENT' THEN 'JUD'
            WHEN 'COURT_ORDER' THEN 'JUD'
            WHEN 'PROCEEDINGS' THEN 'JUD'
            ELSE 'POL'
          END
        """
    )
    op.execute("UPDATE documents SET custodian_user_id = created_by WHERE custodian_user_id IS NULL")
    op.alter_column("documents", "owner_department_id", nullable=False)
    op.alter_column("documents", "custodian_user_id", nullable=False)

    op.create_table(
        "court_packages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("case_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("cases.id", ondelete="CASCADE"), nullable=False),
        sa.Column("package_number", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="DRAFT"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("package_hash", sa.String(length=64), nullable=True),
        sa.Column("seal_algorithm", sa.String(length=32), nullable=True),
        sa.Column("seal_value", sa.String(length=128), nullable=True),
        sa.Column("sealed_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("sealed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("verification_status", sa.String(length=32), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.UniqueConstraint("case_id", "package_number", name="uq_court_packages_case_number"),
    )
    op.create_table(
        "court_package_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("package_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("court_packages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("item_type", sa.String(length=32), nullable=False),
        sa.Column("document_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("documents.id"), nullable=True),
        sa.Column("evidence_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("evidence.id"), nullable=True),
        sa.Column("artifact_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("derived_artifacts.id"), nullable=True),
        sa.Column("label", sa.String(length=200), nullable=False),
        sa.Column("sha256_hash", sa.String(length=64), nullable=False),
        sa.Column("snapshot", sa.Text(), nullable=False),
    )
    op.execute(
        """
        DELETE FROM role_permissions AS link
        USING roles AS role, permissions AS permission
        WHERE link.role_id = role.id
          AND link.permission_id = permission.id
          AND role.name = 'ADMIN'
          AND NOT (
            (permission.resource = 'USER' AND permission.action IN ('CREATE', 'READ', 'UPDATE'))
            OR (permission.resource = 'ROLE' AND permission.action IN ('READ', 'UPDATE'))
            OR (permission.resource = 'DEPARTMENT' AND permission.action = 'READ')
            OR (permission.resource = 'AUDIT_LOG' AND permission.action = 'READ')
          )
        """
    )
    op.execute(
        """
        DELETE FROM role_permissions AS link
        USING roles AS role, permissions AS permission
        WHERE link.role_id = role.id
          AND link.permission_id = permission.id
          AND role.name = 'POLICE_SUPERVISOR'
          AND permission.resource = 'DOCUMENT'
          AND permission.action = 'UPDATE'
        """
    )
    op.execute(
        """
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT role.id, permission.id
        FROM roles AS role
        JOIN permissions AS permission
          ON permission.resource = 'ACCESS_REQUEST'
         AND permission.action IN ('APPROVE', 'REJECT')
        WHERE role.name IN ('FORENSIC_REVIEWER', 'PROSECUTOR')
        ON CONFLICT DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT role.id, permission.id
        FROM roles AS role
        JOIN permissions AS permission
          ON permission.resource = 'DOCUMENT'
         AND permission.action IN ('CREATE', 'UPLOAD')
        WHERE role.name = 'JUDICIAL_USER'
        ON CONFLICT DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT role.id, permission.id
        FROM roles AS role
        JOIN permissions AS permission
          ON (
            permission.resource = 'ACCESS_REQUEST' AND permission.action IN ('READ', 'APPROVE', 'REJECT')
          )
        WHERE role.name = 'JUDICIAL_USER'
        ON CONFLICT DO NOTHING
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION app_can_see_case(target_case uuid)
        RETURNS boolean
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path = public
        AS $$
          SELECT
            target_case IS NOT NULL
            AND NULLIF(current_setting('app.user_id', true), '') IS NOT NULL
            AND (
              EXISTS (
                SELECT 1 FROM case_assignments
                WHERE case_id = target_case
                  AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
                  AND active
              )
              OR EXISTS (
                SELECT 1 FROM access_requests
                WHERE case_id = target_case
                  AND requester_id = NULLIF(current_setting('app.user_id', true), '')::uuid
                  AND status = 'APPROVED'
                  AND (expires_at IS NULL OR expires_at > now())
              )
            );
        $$
        """
    )
    for table in (
        "cases",
        "case_assignments",
        "case_events",
        "documents",
        "document_versions",
        "document_texts",
        "document_index_status",
        "search_chunks",
        "evidence",
        "derived_artifacts",
        "evidence_integrity_events",
        "forensic_requests",
        "forensic_request_evidence",
        "forensic_findings",
        "forensic_finding_artifacts",
        "forensic_reviews",
        "chain_of_custody_events",
        "rag_conversations",
        "rag_messages",
        "rag_citations",
        "access_requests",
        "court_packages",
        "court_package_items",
    ):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    _policy("cases", "app_can_see_case(id)", insert_check="true")
    _policy("case_assignments", "app_can_see_case(case_id)", insert_check="true")
    _policy("case_events", "app_can_see_case(case_id)")
    _policy("documents", "app_can_see_case(case_id)")
    _policy("document_versions", "EXISTS (SELECT 1 FROM documents AS parent WHERE parent.id = document_id AND app_can_see_case(parent.case_id))")
    _policy("document_texts", "EXISTS (SELECT 1 FROM documents AS parent WHERE parent.id = document_id AND app_can_see_case(parent.case_id))")
    _policy("document_index_status", "EXISTS (SELECT 1 FROM documents AS parent WHERE parent.id = document_id AND app_can_see_case(parent.case_id))")
    _policy("search_chunks", "app_can_see_case(case_id)")
    _policy("evidence", "app_can_see_case(case_id)")
    _policy("derived_artifacts", "app_can_see_case(case_id)")
    _policy("evidence_integrity_events", "app_can_see_case(case_id)")
    _policy("forensic_requests", "app_can_see_case(case_id)")
    _policy("forensic_request_evidence", "EXISTS (SELECT 1 FROM forensic_requests AS parent WHERE parent.id = request_id AND app_can_see_case(parent.case_id))")
    _policy("forensic_findings", "EXISTS (SELECT 1 FROM forensic_requests AS parent WHERE parent.id = request_id AND app_can_see_case(parent.case_id))")
    _policy("forensic_finding_artifacts", "EXISTS (SELECT 1 FROM forensic_findings AS finding JOIN forensic_requests AS parent ON parent.id = finding.request_id WHERE finding.id = finding_id AND app_can_see_case(parent.case_id))")
    _policy("forensic_reviews", "EXISTS (SELECT 1 FROM forensic_requests AS parent WHERE parent.id = request_id AND app_can_see_case(parent.case_id))")
    _policy("chain_of_custody_events", "app_can_see_case(case_id)")
    _policy("rag_conversations", "app_can_see_case(case_id)")
    _policy("rag_messages", "EXISTS (SELECT 1 FROM rag_conversations AS parent WHERE parent.id = conversation_id AND app_can_see_case(parent.case_id))")
    _policy("rag_citations", "EXISTS (SELECT 1 FROM rag_messages AS message JOIN rag_conversations AS parent ON parent.id = message.conversation_id WHERE message.id = message_id AND app_can_see_case(parent.case_id))")
    _policy(
        "access_requests",
        "app_can_see_case(case_id) OR requester_id = NULLIF(current_setting('app.user_id', true), '')::uuid",
    )
    _policy("court_packages", "app_can_see_case(case_id)")
    _policy("court_package_items", "EXISTS (SELECT 1 FROM court_packages AS parent WHERE parent.id = package_id AND app_can_see_case(parent.case_id))")
    op.execute(
        """
        DO $$
        BEGIN
          BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'secure_dms') THEN
              EXECUTE 'ALTER ROLE secure_dms BYPASSRLS';
            END IF;
          EXCEPTION
            WHEN insufficient_privilege THEN
              RAISE NOTICE 'Run ALTER ROLE secure_dms BYPASSRLS as a superuser before seeding.';
            WHEN undefined_object THEN
              RAISE NOTICE 'Role secure_dms does not exist.';
          END;
        END $$;
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'secure_dms_app') THEN
            GRANT USAGE ON SCHEMA public TO secure_dms_app;
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO secure_dms_app;
            GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO secure_dms_app;
            GRANT EXECUTE ON FUNCTION app_can_see_case(uuid) TO secure_dms_app;
          END IF;
        END $$;
        """
    )


def _policy(table: str, expression: str, insert_check: str | None = None) -> None:
    check = insert_check or expression
    op.execute(f"DROP POLICY IF EXISTS {table}_tenant ON {table}")
    op.execute(
        f"CREATE POLICY {table}_tenant ON {table} FOR ALL USING ({expression}) WITH CHECK ({check})"
    )


def downgrade() -> None:
    op.execute("ALTER ROLE secure_dms NOBYPASSRLS")
    for table in (
        "court_package_items",
        "court_packages",
        "access_requests",
        "rag_citations",
        "rag_messages",
        "rag_conversations",
        "chain_of_custody_events",
        "forensic_reviews",
        "forensic_finding_artifacts",
        "forensic_findings",
        "forensic_request_evidence",
        "forensic_requests",
        "evidence_integrity_events",
        "derived_artifacts",
        "evidence",
        "search_chunks",
        "document_index_status",
        "document_texts",
        "document_versions",
        "documents",
        "case_events",
        "case_assignments",
        "cases",
    ):
        op.execute(f"DROP POLICY IF EXISTS {table}_tenant ON {table}")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
    op.execute("DROP FUNCTION IF EXISTS app_can_see_case(uuid)")
    op.drop_table("court_package_items")
    op.drop_table("court_packages")
    op.drop_column("derived_artifacts", "storage_encrypted")
    op.drop_column("evidence", "storage_encrypted")
    op.drop_column("document_versions", "seal_value")
    op.drop_column("document_versions", "seal_algorithm")
    op.drop_column("access_requests", "access_kind")
    op.drop_constraint("fk_documents_custodian", "documents", type_="foreignkey")
    op.drop_constraint("fk_documents_owner_department", "documents", type_="foreignkey")
    op.drop_column("documents", "custodian_user_id")
    op.drop_column("documents", "owner_department_id")
