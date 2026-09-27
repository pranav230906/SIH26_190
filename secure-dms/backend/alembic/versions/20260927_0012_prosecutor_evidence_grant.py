"""Keep evidence read on the prosecutor so an approved item grant can pass the role check.

Revision ID: 0012_prosecutor_evidence
Revises: 0011_align
Create Date: 2026-09-27

The custody policy still refuses evidence unless that grant names the item.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0012_prosecutor_evidence"
down_revision: Union[str, None] = "0011_align"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT role.id, permission.id
        FROM roles AS role
        JOIN permissions AS permission
          ON permission.resource = 'EVIDENCE'
         AND permission.action IN ('READ', 'DOWNLOAD')
        WHERE role.name = 'PROSECUTOR'
        ON CONFLICT DO NOTHING
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
          AND permission.resource = 'EVIDENCE'
          AND permission.action IN ('READ', 'DOWNLOAD')
        """
    )
