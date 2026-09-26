"""Central resource and action identifiers. Routes must not invent their own strings."""

from app.constants import Action, ResourceType


def permission_code(resource: ResourceType, action: Action) -> str:
    return f"{resource.value}.{action.value}"
