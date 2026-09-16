ALTER TABLE character_material_bindings ADD COLUMN sort_order INTEGER CHECK (sort_order >= 0);
