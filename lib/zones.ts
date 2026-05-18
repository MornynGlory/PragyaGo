import { supabase } from './supabase';

// Check which zone a GPS coordinate falls into
export const getZoneForLocation = async (lat: number, lng: number) => {
  try {
    const { data: zones } = await supabase
      .from('zones')
      .select('*, regions(name)')
      .not('boundary_lat_min', 'is', null)
      .not('boundary_lat_max', 'is', null)
      .not('boundary_lng_min', 'is', null)
      .not('boundary_lng_max', 'is', null);

    if (!zones || zones.length === 0) return null;

    for (const zone of zones) {
      if (
        lat >= zone.boundary_lat_min &&
        lat <= zone.boundary_lat_max &&
        lng >= zone.boundary_lng_min &&
        lng <= zone.boundary_lng_max
      ) {
        return zone;
      }
    }
    return null;
  } catch (error) {
    console.error('Error getting zone for location:', error);
    return null;
  }
};

// Auto assign driver to zone based on GPS and detect migrations
export const autoAssignDriverZone = async (
  driverId: string,
  lat: number,
  lng: number,
  currentZoneId: string | null
) => {
  try {
    const newZone = await getZoneForLocation(lat, lng);
    const newZoneId = newZone?.id || null;

    // No change needed
    if (newZoneId === currentZoneId) return { changed: false, newZone: null };

    // Update driver's zone
    await supabase
      .from('drivers')
      .update({ zone_id: newZoneId })
      .eq('id', driverId);

    // Record migration if moving between zones
    if (currentZoneId && newZoneId) {
      const { data: oldZone } = await supabase
        .from('zones')
        .select('name')
        .eq('id', currentZoneId)
        .single();

      await supabase.from('driver_zone_migrations').insert([{
        driver_id: driverId,
        from_zone_id: currentZoneId,
        to_zone_id: newZoneId,
        from_zone_name: oldZone?.name || 'Unknown',
        to_zone_name: newZone?.name || 'Unknown',
        migrated_at: new Date().toISOString(),
      }]);

      return { changed: true, newZone, oldZoneName: oldZone?.name };
    }

    return { changed: true, newZone, oldZoneName: null };
  } catch (error) {
    console.error('Error auto-assigning zone:', error);
    return { changed: false, newZone: null };
  }
};
