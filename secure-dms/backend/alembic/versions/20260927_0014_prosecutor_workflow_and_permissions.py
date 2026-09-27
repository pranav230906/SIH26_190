"""Prosecutor workflow permissions for documents, revisions, and case transitions.

Revision ID: 0014_prosecutor_workflow
Revises: 0013_custody_transfer_and_roles
Create Date: 2026-09-27
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0014_prosecutor_workflow"
down_revision: Union[str, None] = "0013_custody_transfer_and_roles"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Ensure all required permissions exist
    op.execute(
        """
        INSERT INTO permissions (id, resource, action, description)
        VALUES
            (gen_random_uuid(), 'CASE', 'UPDATE', 'Allows UPDATE on CASE.'),
            (gen_random_uuid(), 'DOCUMENT', 'UPDATE', 'Allows UPDATE on DOCUMENT.'),
            (gen_random_uuid(), 'DOCUMENT', 'DELETE', 'Allows DELETE on DOCUMENT.'),
            (gen_random_uuid(), 'DOCUMENT', 'REVIEW', 'Allows REVIEW on DOCUMENT.'),
            (gen_random_uuid(), 'DOCUMENT', 'APPROVE', 'Allows APPROVE on DOCUMENT.'),
            (gen_random_uuid(), 'REVISION', 'CREATE', 'Allows CREATE on REVISION.'),
            (gen_random_uuid(), 'REVISION', 'UPDATE', 'Allows UPDATE on REVISION.'),
            (gen_random_uuid(), 'REVISION', 'REVIEW', 'Allows REVIEW on REVISION.'),
            (gen_random_uuid(), 'REVISION', 'APPROVE', 'Allows APPROVE on REVISION.'),
            (gen_random_uuid(), 'REVISION', 'REJECT', 'Allows REJECT on REVISION.')
        ON CONFLICT (resource, action) DO NOTHING;
        """
    )

    # 2. Grant permissions to the PROSECUTOR role
    op.execute(
        """
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT role.id, permission.id
        FROM roles AS role
        JOIN permissions AS permission
          ON (permission.resource = 'CASE' AND permission.action = 'UPDATE')
          OR (permission.resource = 'DOCUMENT' AND permission.action IN ('UPDATE', 'DELETE', 'REVIEW', 'APPROVE'))
          OR (permission.resource = 'REVISION' AND permission.action IN ('CREATE', 'UPDATE', 'REVIEW', 'APPROVE', 'REJECT'))
        WHERE role.name = 'PROSECUTOR'
        ON CONFLICT DO NOTHING;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM role_permissions AS link
        USING roles AS role, permissions AS permission
        WHERE link.role_id = role.id
          AND link.permission_id = permission.id
          AND role.name = 'PROSECUTOR'
          AND (
              (permission.resource = 'CASE' AND permission.action = 'UPDATE')
              OR (permission.resource = 'DOCUMENT' AND permission.action IN ('UPDATE', 'DELETE', 'REVIEW', 'APPROVE'))
              OR (permission.resource = 'REVISION' AND permission.action IN ('CREATE', 'UPDATE', 'REVIEW', 'APPROVE', 'REJECT'))
          );
        """
    )
