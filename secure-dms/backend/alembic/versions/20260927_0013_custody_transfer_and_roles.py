"""Evidence custodian tracking, custody transfer, lookup function, and judicial request permissions.

Revision ID: 0013_custody_transfer_and_roles
Revises: 0012_prosecutor_evidence
Create Date: 2026-09-27
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0013_custody_transfer_and_roles"
down_revision: Union[str, None] = "0012_prosecutor_evidence"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Evidence custodian tracking
    op.add_column("evidence", sa.Column("custodian_user_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_evidence_custodian",
        "evidence",
        "users",
        ["custodian_user_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.execute("UPDATE evidence SET custodian_user_id = created_by WHERE custodian_user_id IS NULL")
    op.alter_column("evidence", "custodian_user_id", nullable=False)
    op.create_index("ix_evidence_custodian_user_id", "evidence", ["custodian_user_id"])

    # 2. Permissions for ACCESS_REQUEST.CREATE on JUDICIAL_USER and FORENSIC_REVIEWER
    op.execute(
        """
        INSERT INTO permissions (id, resource, action, description)
        VALUES (gen_random_uuid(), 'ACCESS_REQUEST', 'CREATE', 'Allows CREATE on ACCESS_REQUEST.')
        ON CONFLICT (resource, action) DO NOTHING;

        INSERT INTO role_permissions (role_id, permission_id)
        SELECT role.id, permission.id
        FROM roles AS role
        JOIN permissions AS permission
          ON permission.resource = 'ACCESS_REQUEST'
         AND permission.action = 'CREATE'
        WHERE role.name IN ('JUDICIAL_USER', 'FORENSIC_REVIEWER')
        ON CONFLICT DO NOTHING;
        """
    )

    # 3. Security definer lookup helper for unassigned case access requests
    op.execute(
        """
        CREATE OR REPLACE FUNCTION lookup_case_by_number(p_case_number text)
        RETURNS TABLE(id uuid, case_number varchar, department_id uuid, status varchar)
        LANGUAGE sql
        SECURITY DEFINER
        SET search_path = public
        AS $$
          SELECT id, case_number, department_id, status FROM cases WHERE case_number = p_case_number;
        $$;

        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'secure_dms_app') THEN
            GRANT EXECUTE ON FUNCTION lookup_case_by_number(text) TO secure_dms_app;
          END IF;
        END $$;
        """
    )

    # 4. Enhance app_can_see_case to include owning department supervisors
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
              OR EXISTS (
                SELECT 1 FROM cases c
                JOIN users u ON u.id = NULLIF(current_setting('app.user_id', true), '')::uuid
                JOIN roles r ON r.id = u.role_id
                WHERE c.id = target_case
                  AND c.department_id = u.department_id
                  AND r.name = 'POLICE_SUPERVISOR'
              )
            );
        $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS lookup_case_by_number(text)")
    op.drop_index("ix_evidence_custodian_user_id", table_name="evidence")
    op.drop_constraint("fk_evidence_custodian", "evidence", type_="foreignkey")
    op.drop_column("evidence", "custodian_user_id")
