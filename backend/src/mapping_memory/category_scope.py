from __future__ import annotations

from dataclasses import dataclass
from typing import Any


class CategoryScopeError(ValueError):
    pass


@dataclass(frozen=True)
class CategoryScope:
    category_id: int | None = None
    uncategorized: bool = False

    @property
    def is_all(self) -> bool:
        return self.category_id is None and not self.uncategorized

    @property
    def chroma_where(self) -> dict[str, Any] | None:
        if self.uncategorized:
            return {"category_scope": "uncategorized"}
        if self.category_id is not None:
            return {"category_scope": f"category:{self.category_id}"}
        return None

    def matches_category_id(self, category_id: int | None) -> bool:
        if self.uncategorized:
            return category_id is None
        if self.category_id is not None:
            return category_id == self.category_id
        return True


def make_category_scope(
    *,
    category_id: int | None = None,
    uncategorized: bool = False,
) -> CategoryScope:
    if category_id is not None and uncategorized:
        raise CategoryScopeError("category_id and uncategorized cannot both be set")
    if category_id is not None and category_id < 1:
        raise CategoryScopeError("category_id must be positive")

    return CategoryScope(category_id=category_id, uncategorized=uncategorized)
