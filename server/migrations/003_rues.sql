-- Rues nommées relevées lors de l'analyse OSM (voies et coordonnées de leurs nœuds) : permet de nommer un
-- nouveau point d'après la rue ou le croisement sans interroger Overpass à chaque fois.
ALTER TABLE osm_analyses ADD COLUMN streets jsonb;
