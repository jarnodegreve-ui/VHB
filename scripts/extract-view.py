#!/usr/bin/env python3
"""
Extract a function range from src/App.tsx to its own file with auto-detected imports.

Usage: python3 scripts/extract-view.py <start> <end> <out_path>
Example: python3 scripts/extract-view.py 1248 1321 src/views/ContactsView.tsx
"""
import re
import sys
from pathlib import Path

LUCIDE_ICONS = {
    "LayoutDashboard", "MapPin", "Calendar", "Bell", "LogOut", "Bus",
    "AlertTriangle", "Clock", "ChevronRight", "ChevronUp", "ChevronDown",
    "Info", "FileText", "Download", "Plus", "Settings", "Users", "Upload",
    "Trash2", "RotateCcw", "Menu", "X", "Pencil", "Search", "Phone",
    "Activity", "CalendarDays", "CheckCircle", "Circle", "Eye", "EyeOff",
    "Filter", "Save", "Check", "Copy", "ArrowRight", "ArrowLeft", "MoreHorizontal",
    "Star", "Heart", "Home", "Mail", "Lock", "Unlock", "Send", "RefreshCw",
    "RefreshCcw", "Loader2", "Loader", "ExternalLink", "Image", "Paperclip",
    "Wrench", "Shield", "Zap", "Car", "Truck", "Navigation", "Route",
    "Timer", "Hourglass", "TrendingUp", "TrendingDown", "BarChart", "PieChart",
    "Database", "Cloud", "Globe", "Tag", "Flag", "Bookmark",
}
# 'User' is special-cased (imported as UserIcon), 'Map' is imported as MapIcon
SPECIAL_LUCIDE = {"User as UserIcon": "UserIcon", "Map as MapIcon": "MapIcon"}

TYPES = {
    "View", "User", "Shift", "Update", "Diversion", "Service",
    "SwapRequest", "LeaveRequest", "PlanningMatrixRow", "PlanningCode",
    "PlanningMatrixImportHistory", "ActivityLogEntry", "Role",
}

UI_COMPONENTS = {
    "AdminPageHeader", "AdminSubsectionHeader", "ConfirmationModal",
    "EmptyState", "ViewLoader", "CredentialsModal",
}

LIB_UI = {"cn", "notify", "getSupabaseAuthHeaders"}

CONSTANTS = {
    "MOCK_DIVERSIONS", "MOCK_SHIFTS", "MOCK_UPDATES", "MOCK_USERS", "MOCK_SERVICES",
}

REACT_HOOKS = {"useState", "useEffect", "useMemo", "useDeferredValue",
               "useRef", "useCallback", "useReducer", "useContext"}


def identifier_used(name: str, body: str) -> bool:
    return bool(re.search(rf"\b{re.escape(name)}\b", body))


def extract(start: int, end: int, out_path: str) -> None:
    app = Path("src/App.tsx").read_text().splitlines()
    body_lines = app[start - 1:end]
    body = "\n".join(body_lines)

    # Make function exported
    body = re.sub(r"^function (\w+)", r"export function \1", body, count=1)

    imports = []

    # React
    react_named = sorted(h for h in REACT_HOOKS if identifier_used(h, body))
    needs_react_default = "React." in body or "React.FormEvent" in body or "React.ReactNode" in body or "React.FC" in body
    if react_named or needs_react_default:
        if needs_react_default and react_named:
            imports.append(f"import React, {{ {', '.join(react_named)} }} from 'react';")
        elif needs_react_default:
            imports.append("import React from 'react';")
        else:
            imports.append(f"import {{ {', '.join(react_named)} }} from 'react';")

    # motion
    motion_parts = []
    if identifier_used("motion", body):
        motion_parts.append("motion")
    if identifier_used("AnimatePresence", body):
        motion_parts.append("AnimatePresence")
    if motion_parts:
        imports.append(f"import {{ {', '.join(motion_parts)} }} from 'motion/react';")

    # lucide-react
    lucide_used = sorted(i for i in LUCIDE_ICONS if identifier_used(i, body))
    special_used = []
    for k, short in SPECIAL_LUCIDE.items():
        if identifier_used(short, body):
            special_used.append(k)
    all_lucide = lucide_used + special_used
    if all_lucide:
        imports.append(f"import {{ {', '.join(all_lucide)} }} from 'lucide-react';")

    # types
    types_used = sorted(t for t in TYPES if identifier_used(t, body) and t != "UserIcon")
    if types_used:
        # figure out relative path depth
        depth = out_path.count("/") - 1  # "src/views/Foo.tsx" => 1, "src/views/admin/Foo.tsx" => 2
        prefix = "../" * depth
        imports.append(f"import type {{ {', '.join(types_used)} }} from '{prefix}types';")

    # lib/ui
    lib_used = sorted(u for u in LIB_UI if identifier_used(u, body))
    if lib_used:
        depth = out_path.count("/") - 1
        prefix = "../" * depth
        imports.append(f"import {{ {', '.join(lib_used)} }} from '{prefix}lib/ui';")

    # components/ui
    ui_used = sorted(c for c in UI_COMPONENTS if identifier_used(c, body))
    if ui_used:
        depth = out_path.count("/") - 1
        prefix = "../" * depth
        imports.append(f"import {{ {', '.join(ui_used)} }} from '{prefix}components/ui';")

    # constants
    const_used = sorted(c for c in CONSTANTS if identifier_used(c, body))
    if const_used:
        depth = out_path.count("/") - 1
        prefix = "../" * depth
        imports.append(f"import {{ {', '.join(const_used)} }} from '{prefix}constants';")

    # planning helpers (lib/planning)
    planning_helpers = ["ResolvedPlanningAssignment", "normalizePlanningToken",
                        "getServiceSegments", "resolvePlanningAssignment"]
    planning_used = [h for h in planning_helpers if identifier_used(h, body)]
    if planning_used:
        depth = out_path.count("/") - 1
        prefix = "../" * depth
        # Types go in type-only import if only types used
        types_only = planning_used == ["ResolvedPlanningAssignment"]
        keyword = "import type" if types_only else "import"
        imports.append(f"{keyword} {{ {', '.join(planning_used)} }} from '{prefix}lib/planning';")

    # supabase
    if identifier_used("supabase", body) or identifier_used("isSupabaseConfigured", body):
        parts = []
        if identifier_used("isSupabaseConfigured", body):
            parts.append("isSupabaseConfigured")
        if identifier_used("supabase", body):
            parts.append("supabase")
        depth = out_path.count("/") - 1
        prefix = "../" * depth
        imports.append(f"import {{ {', '.join(parts)} }} from '{prefix}lib/supabase';")

    header = "\n".join(imports) + "\n\n"
    Path(out_path).write_text(header + body + "\n")
    print(f"Wrote {out_path} ({end - start + 1} lines)")


if __name__ == "__main__":
    start, end, out_path = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
    extract(start, end, out_path)
