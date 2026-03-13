/* ════════════════════════════════════════════════
   routing.js — OSRM Route Fetching & Step Parsing
   Uses the free OSRM public routing service
   ════════════════════════════════════════════════ */

'use strict';

const Routing = (() => {

    const OSRM_BASE = 'https://router.project-osrm.org';

    /* ── Maneuver → simplified direction ── */
    const MANEUVER_MAP = {
        'turn': 'STRAIGHT',
        'new name': 'STRAIGHT',
        'depart': 'STRAIGHT',
        'arrive': 'STRAIGHT',
        'merge': 'STRAIGHT',
        'on ramp': 'STRAIGHT',
        'off ramp': 'STRAIGHT',
        'fork': 'STRAIGHT',
        'end of road': 'STRAIGHT',
        'continue': 'STRAIGHT',
        'roundabout': 'STRAIGHT',
        'rotary': 'STRAIGHT',
        'roundabout turn': 'STRAIGHT',
        'notification': 'STRAIGHT',
        'exit roundabout': 'STRAIGHT',
        'exit rotary': 'STRAIGHT',
    };

    /* Map modifier to direction */
    const MODIFIER_MAP = {
        'left': 'LEFT',
        'sharp left': 'LEFT',
        'slight left': 'LEFT',
        'right': 'RIGHT',
        'sharp right': 'RIGHT',
        'slight right': 'RIGHT',
        'uturn': 'UTURN',
        'straight': 'STRAIGHT',
    };

    /**
     * Fetch route from OSRM.
     * @param {{ lat: number, lng: number }} start
     * @param {{ lat: number, lng: number }} end
     * @returns {Promise<{ geometry: [{lat,lng}], steps: Array, duration: number, distance: number }>}
     */
    async function fetchRoute(start, end) {
        const url = `${OSRM_BASE}/route/v1/bike/${start.lng},${start.lat};${end.lng},${end.lat}` +
            `?overview=full&geometries=geojson&steps=true&annotations=false`;

        let res = await fetch(url);
        let data = await res.json();

        // Fallback to driving if bike profile unavailable
        if (data.code !== 'Ok') {
            const fallback = `${OSRM_BASE}/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}` +
                `?overview=full&geometries=geojson&steps=true&annotations=false`;
            res = await fetch(fallback);
            data = await res.json();
        }

        if (data.code !== 'Ok' || !data.routes || !data.routes.length) {
            throw new Error('No route found: ' + (data.message || data.code));
        }

        const route = data.routes[0];

        // Parse geometry (GeoJSON coords are [lng, lat])
        const geometry = route.geometry.coordinates.map(c => ({
            lat: c[1], lng: c[0],
        }));

        // Parse steps from first leg
        const leg = route.legs[0];
        const steps = leg.steps.map(s => ({
            direction: parseDirection(s.maneuver),
            distance: Math.round(s.distance),
            duration: Math.round(s.duration),
            name: s.name || '',
            location: { lat: s.maneuver.location[1], lng: s.maneuver.location[0] },
        }));

        return {
            geometry,
            steps,
            duration: Math.round(route.duration),
            distance: Math.round(route.distance),
        };
    }

    /** Parse OSRM maneuver object → LEFT / RIGHT / STRAIGHT / UTURN */
    function parseDirection(maneuver) {
        if (!maneuver) return 'STRAIGHT';
        const modifier = (maneuver.modifier || '').toLowerCase();
        if (MODIFIER_MAP[modifier]) return MODIFIER_MAP[modifier];
        const type = (maneuver.type || '').toLowerCase();
        return MANEUVER_MAP[type] || 'STRAIGHT';
    }

    /**
     * Find the current active step and distance to its end.
     * @param {{ lat: number, lng: number }} pos
     * @param {Array} steps — parsed steps
     * @param {number} currentIdx — last known step index
     * @returns {{ index: number, direction: string, distance: number, street: string } | null}
     */
    function findCurrentStep(pos, steps, currentIdx) {
        if (!steps.length) return null;

        // Advance step index if we've passed the current step location
        let idx = currentIdx;
        for (let i = currentIdx; i < steps.length - 1; i++) {
            const nextStepLoc = steps[i + 1].location;
            const distToNext = MapRenderer.haversine(pos, nextStepLoc);
            if (distToNext < 25) {
                idx = i + 1;
            }
        }

        // Clamp
        if (idx >= steps.length) idx = steps.length - 1;

        // Calculate distance to the *next* step (where the turn happens)
        let nextIdx = Math.min(idx + 1, steps.length - 1);
        // If current step IS the turn, use it
        if (steps[idx].direction !== 'STRAIGHT') {
            nextIdx = idx;
        } else {
            // Look ahead for next non-straight
            for (let j = idx + 1; j < steps.length; j++) {
                nextIdx = j;
                if (steps[j].direction !== 'STRAIGHT') break;
            }
        }

        const distToTurn = MapRenderer.haversine(pos, steps[nextIdx].location);

        return {
            index: idx,
            direction: steps[nextIdx].direction,
            distance: Math.round(distToTurn),
            street: steps[nextIdx].name || steps[idx].name || '',
        };
    }

    /* ── Public ── */
    return {
        fetchRoute,
        findCurrentStep,
        parseDirection,
    };

})();
