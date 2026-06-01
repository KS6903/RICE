"""Trim every existing warehouse layout to just Milling Floor + Premium Storage.

- Deletes other zones (pallet.zone_id auto-nulls via ON DELETE SET NULL).
- Resizes the two we keep to fill the floor: milling left, premium_storage right.
- Pulls any pallets that ended up outside both zones back inside premium_storage
  (or milling if they were already in milling).
- Re-runs zone-containing logic to set the correct zone_id on every pallet.
"""
from decimal import Decimal
from app.core.database import SessionLocal
from app.models.warehouse import WarehouseLayout, WarehouseZone, Pallet

# Same as DEFAULT_ZONES in canva.py
MILLING       = ("milling",         "Milling Floor",    1.0,  1.0, 13.0, 18.0, "#94a3b8")
PREMIUM       = ("premium_storage", "Premium Storage", 15.0,  1.0, 14.0, 18.0, "#10b981")
KEEP_TYPES = {"milling", "premium_storage"}


def _set_zone(z: WarehouseZone, spec):
    _, name, x, y, w, h, color = spec
    z.name = name
    z.x_m = Decimal(str(x))
    z.y_m = Decimal(str(y))
    z.width_m = Decimal(str(w))
    z.height_m = Decimal(str(h))
    z.color_hex = color


def _zone_at(zones, x: float, y: float):
    for z in zones:
        zx, zy = float(z.x_m), float(z.y_m)
        zw, zh = float(z.width_m), float(z.height_m)
        if zx <= x <= zx + zw and zy <= y <= zy + zh:
            return z
    return None


def main():
    db = SessionLocal()
    try:
        layouts = db.query(WarehouseLayout).all()
        if not layouts:
            print("(no layouts to clean)")
            return

        for layout in layouts:
            zones = db.query(WarehouseZone).filter(WarehouseZone.layout_id == layout.id).all()
            keep = [z for z in zones if z.zone_type in KEEP_TYPES]
            drop = [z for z in zones if z.zone_type not in KEEP_TYPES]

            milling = next((z for z in keep if z.zone_type == "milling"), None)
            premium = next((z for z in keep if z.zone_type == "premium_storage"), None)

            if milling is None:
                milling = WarehouseZone(layout_id=layout.id, zone_type="milling",
                                        name="Milling Floor", x_m=0, y_m=0, width_m=1, height_m=1)
                db.add(milling)
            _set_zone(milling, MILLING)

            if premium is None:
                premium = WarehouseZone(layout_id=layout.id, zone_type="premium_storage",
                                        name="Premium Storage", x_m=0, y_m=0, width_m=1, height_m=1)
                db.add(premium)
            _set_zone(premium, PREMIUM)

            for z in drop:
                db.delete(z)

            db.flush()

            # Pull pallets back into premium_storage if they're now in dead space.
            kept = [milling, premium]
            pallets = db.query(Pallet).filter(Pallet.layout_id == layout.id).all()
            relocated = 0
            for p in pallets:
                hit = _zone_at(kept, float(p.x_m), float(p.y_m))
                if hit is not None:
                    p.zone_id = hit.id
                    continue
                # Snap into the right side of premium_storage
                p.x_m = Decimal(str(round(float(premium.x_m) + 1.0, 2)))
                p.y_m = Decimal(str(round(float(premium.y_m) + 1.0, 2)))
                p.zone_id = premium.id
                relocated += 1

            db.commit()
            print(f"  [{layout.name}] dropped {len(drop)} extra zones, relocated {relocated} pallets")

        print("Done.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
