"""Walk a decoded pycrate ASN.1 object into a JSON-friendly node tree.

Spec scaffolding (message / c1 / criticalExtensions / nonCriticalExtension
chains) is flattened so the tree shows the fields an engineer cares about,
in the order the spec defines them.
"""

from .labels import pretty, split_release, humanize_enum
from .semantics import decorate_leaf, decorate_struct

SKELETON_CHOICES = {
    "message", "c1", "c2", "c3", "c4", "criticalExtensions", "messageClassExtension",
    "messageClassExtensionFuture-r13", "messageClassExtensionFuture-r15",
    "messageClassExtensionFuture-r16", "messageClassExtensionFuture-r17",
}
HOIST_SEQUENCES = {"nonCriticalExtension"}

MAX_HEX_INLINE = 48


def _typename(obj):
    tr = getattr(obj, "_typeref", None)
    if tr is not None:
        called = getattr(tr, "called", None)
        if isinstance(called, tuple) and len(called) == 2:
            return called
    tr2 = getattr(obj, "_tr", None)
    if tr2 is not None and getattr(tr2, "_name", None):
        return (getattr(tr2, "_mod", None), tr2._name)
    return (getattr(obj, "_mod", None), None)


def fmt_bits(v, n):
    if n == 0:
        return "''B"
    if n <= 16:
        return "'" + format(v, f"0{n}b") + "'B"
    width = (n + 3) // 4
    return f"0x{v:0{width}X} ({n} bits)"


def fmt_bytes(b):
    h = b.hex().upper()
    if len(b) <= MAX_HEX_INLINE:
        return " ".join(h[i:i + 2] for i in range(0, len(h), 2)), None
    short = " ".join(h[i:i + 2] for i in range(0, MAX_HEX_INLINE * 2, 2))
    return f"{short} … ({len(b)} bytes)", h


class Asn1Walker:
    """nest_hook(field, typename, value_bytes, parent_value) -> embedded index or None."""

    def __init__(self, module, nest_hook=None):
        self.module = module
        self.nest_hook = nest_hook
        self._parents = []

    # -- public --------------------------------------------------------------
    def walk_root(self, obj, val, name=None):
        nodes = self._walk(obj, val, name or obj._name, ())
        if len(nodes) == 1:
            return nodes[0]
        return {"k": name or obj._name, "l": pretty(name or obj._name), "c": nodes}

    # -- internals -----------------------------------------------------------
    def _node(self, obj, name, path):
        mod, tname = _typename(obj)
        base, rel = split_release(name) if isinstance(name, str) else (name, None)
        n = {"k": name, "l": pretty(name) if isinstance(name, str) else str(name)}
        if rel:
            n["r"] = rel
        n["t"] = tname or obj.TYPE
        return n, (mod or self.module), tname

    def _walk(self, obj, val, name, path):
        """Return a list of nodes (skeleton levels return their children)."""
        T = obj.TYPE
        if T in ("SEQUENCE", "SET"):
            return self._walk_seq(obj, val, name, path)
        if T == "CHOICE":
            return self._walk_choice(obj, val, name, path)
        if T in ("SEQUENCE OF", "SET OF"):
            return [self._walk_seqof(obj, val, name, path)]
        if T == "OPEN_TYPE":
            return [self._walk_open(obj, val, name, path)]
        return [self._walk_leaf(obj, val, name, path)]

    def _walk_seq(self, obj, val, name, path):
        node, mod, tname = self._node(obj, name, path)
        children = []
        if isinstance(val, dict):
            self._parents.append(val)
            cont = obj._cont
            seen = set()
            for cname, cobj in cont.items():
                if cname not in val:
                    continue
                seen.add(cname)
                cval = val[cname]
                if cobj.TYPE in ("SEQUENCE", "SET") and (
                        cname in HOIST_SEQUENCES or (_typename(cobj)[1] or "").endswith("-IEs")):
                    # flatten nonCriticalExtension chains and *-IEs wrappers into this level
                    children.extend(self._walk_seq(cobj, cval, cname, path + (cname,))[0].get("c", []))
                    continue
                children.extend(self._walk(cobj, cval, cname, path + (cname,)))
            for cname in val:
                if cname not in seen:
                    children.append(generic_node(cname, val[cname]))
            self._parents.pop()
        deco = decorate_struct(mod, tname, name, val)
        if deco:
            node.update(deco)
        node["c"] = children
        return [node]

    def _walk_choice(self, obj, val, name, path):
        if not (isinstance(val, tuple) and len(val) == 2):
            return [generic_node(name, val)]
        alt, aval = val
        aobj = None
        cont = getattr(obj, "_cont", None)
        if cont is not None:
            try:
                aobj = cont[alt] if alt in cont else None
            except Exception:
                aobj = None
        if aobj is None:
            n = generic_node(name, aval)
            n["ch"] = alt
            n["v"] = n.get("v") or "unknown extension"
            return [n]
        if name in SKELETON_CHOICES:
            # pass straight through to the chosen alternative
            if aobj.TYPE in ("SEQUENCE", "SET"):
                inner = self._walk_seq(aobj, aval, alt, path + (alt,))[0]
                tn = _typename(aobj)[1] or ""
                if alt.endswith("-IEs") or tn.endswith("-IEs") or split_release(alt)[1]:
                    return inner.get("c", [])
                return [inner]
            if aobj.TYPE == "CHOICE":
                return self._walk_choice(aobj, aval, alt, path + (alt,))
            if aobj.TYPE == "NULL":
                return [{"k": alt, "l": pretty(alt), "t": "NULL", "v": "present"}]
        node, mod, tname = self._node(obj, name, path)
        node["ch"] = alt
        node["chl"] = pretty(alt)
        sub = self._walk(aobj, aval, alt, path + (alt,))
        if aobj.TYPE in ("SEQUENCE", "SET") and len(sub) == 1:
            node["c"] = sub[0].get("c", [])
            for key in ("h", "tag", "plmn"):
                if key in sub[0]:
                    node[key] = sub[0][key]
        elif aobj.TYPE == "NULL":
            node["v"] = pretty(alt)
        elif len(sub) == 1 and "c" not in sub[0]:
            leaf = sub[0]
            node["v"] = leaf.get("v")
            for key in ("h", "tag", "q", "num", "x", "emb"):
                if key in leaf:
                    node[key] = leaf[key]
            node["v"] = f"{pretty(alt)}: {leaf.get('v')}"
        else:
            node["c"] = sub
        return [node]

    def _walk_seqof(self, obj, val, name, path):
        node, mod, tname = self._node(obj, name, path)
        item = obj._cont
        children = []
        if isinstance(val, list):
            for i, v in enumerate(val):
                sub = self._walk(item, v, f"[{i}]", path + (i,)) if item is not None else [generic_node(f"[{i}]", v)]
                for s in sub:
                    s["k"] = f"[{i}]"
                    s["l"] = f"#{i + 1}"
                    s.pop("r", None)
                children.append(sub[0] if len(sub) == 1 else {"k": f"[{i}]", "l": f"#{i + 1}", "c": sub})
            node["n"] = len(val)
        deco = decorate_struct(mod, tname, name, val)
        if deco:
            node.update(deco)
        node["c"] = children
        return node

    def _walk_open(self, obj, val, name, path):
        node, mod, tname = self._node(obj, name, path)
        if isinstance(val, tuple) and len(val) == 2:
            ident, inner = val
            sub_obj = None
            try:
                sub_obj = obj._get_val_obj(ident)
            except Exception:
                sub_obj = None
            if sub_obj is not None:
                sub = self._walk(sub_obj, inner, ident if isinstance(ident, str) else name, path)
                if len(sub) == 1:
                    s = sub[0]
                    s["k"] = name
                    s["l"] = pretty(ident) if isinstance(ident, str) else pretty(name)
                    s["t"] = ident if isinstance(ident, str) else s.get("t")
                    return s
                node["c"] = sub
                return node
            g = generic_node(name, inner)
            g["t"] = ident if isinstance(ident, str) else "OPEN"
            return g
        return generic_node(name, val)

    def _walk_leaf(self, obj, val, name, path):
        node, mod, tname = self._node(obj, name, path)
        T = obj.TYPE
        deco = None
        if T == "INTEGER":
            node["v"] = str(val)
            deco = decorate_leaf(mod, tname, name, val)
        elif T == "ENUMERATED":
            node["v"] = str(val)
            hv = humanize_enum(val)
            if hv and hv != val:
                node["h"] = hv
            deco = decorate_leaf(mod, tname, name, val)
        elif T == "BOOLEAN":
            node["v"] = "true" if val else "false"
        elif T == "NULL":
            node["v"] = "present"
        elif T == "BIT STRING":
            if isinstance(val, tuple) and len(val) == 2 and isinstance(val[0], str):
                # BIT STRING CONTAINING another type
                cont = getattr(obj, "_const_cont", None)
                if cont is not None:
                    sub = self._walk(cont, val[1], val[0], path)
                    node["c"] = sub[0].get("c", sub) if len(sub) == 1 else sub
                    node["v"] = f"contains {val[0]}"
                    return node
            elif isinstance(val, tuple):
                v, n = val
                node["v"] = fmt_bits(v, n)
                named = _named_bits(obj, v, n)
                if named is not None:
                    node["h"] = named
                deco = decorate_leaf(mod, tname, name, val)
        elif T == "OCTET STRING":
            if isinstance(val, tuple) and len(val) == 2 and isinstance(val[0], str):
                # OCTET STRING (CONTAINING X), already decoded by pycrate
                cont = getattr(obj, "_const_cont", None)
                if cont is not None:
                    sub = self._walk(cont, val[1], val[0], path)
                    if len(sub) == 1 and "c" in sub[0]:
                        node["c"] = sub[0]["c"]
                        for key in ("h", "tag"):
                            if key in sub[0]:
                                node[key] = sub[0][key]
                    else:
                        node["c"] = sub
                    node["v"] = f"contains {val[0]}"
                    node["cont"] = val[0]
                    return node
                node["v"] = f"contains {val[0]}"
                return node
            if isinstance(val, (bytes, bytearray)):
                v, full = fmt_bytes(bytes(val))
                node["v"] = v
                if full:
                    node["x"] = full
                deco = decorate_leaf(mod, tname, name, val)
                if self.nest_hook is not None:
                    parent = self._parents[-1] if self._parents else None
                    emb = self.nest_hook(name, tname, bytes(val), parent)
                    if emb is not None:
                        node["emb"] = emb
        elif isinstance(val, str):
            node["v"] = val
        else:
            node["v"] = repr(val)
        if deco:
            node.update(deco)
        if node.get("h") is not None and node.get("h") == node.get("v"):
            del node["h"]
        return node


def _named_bits(obj, v, n):
    names = getattr(obj, "_cont", None)
    if not names or not hasattr(names, "items"):
        return None
    try:
        on = [nm for nm, off in names.items() if isinstance(off, int) and off < n and (v >> (n - 1 - off)) & 1]
    except Exception:
        return None
    return ", ".join(on) if on else "none set"


def generic_node(name, val):
    """Fallback for values without type information."""
    k = name if isinstance(name, str) else str(name)
    n = {"k": k, "l": pretty(k)}
    if isinstance(val, dict):
        n["c"] = [generic_node(ck, cv) for ck, cv in val.items()]
    elif isinstance(val, list):
        n["c"] = [generic_node(f"[{i}]", v) for i, v in enumerate(val)]
        for i, c in enumerate(n["c"]):
            c["l"] = f"#{i + 1}"
        n["n"] = len(val)
    elif isinstance(val, tuple) and len(val) == 2 and isinstance(val[0], str):
        sub = generic_node(val[0], val[1])
        n["ch"] = val[0]
        n["chl"] = pretty(val[0])
        if "c" in sub:
            n["c"] = sub["c"]
        else:
            n["v"] = f"{pretty(val[0])}: {sub.get('v')}"
    elif isinstance(val, tuple) and len(val) == 2 and isinstance(val[0], int):
        n["v"] = fmt_bits(val[0], val[1])
    elif isinstance(val, (bytes, bytearray)):
        v, full = fmt_bytes(bytes(val))
        n["v"] = v
        if full:
            n["x"] = full
    elif isinstance(val, bool):
        n["v"] = "true" if val else "false"
    elif val is None:
        n["v"] = "present"
    else:
        n["v"] = str(val)
        hv = humanize_enum(val) if isinstance(val, str) else None
        if hv and hv != val:
            n["h"] = hv
    return n
