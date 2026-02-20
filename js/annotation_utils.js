function areAnnotationsEqual(a, b) {
    if (a.type !== b.type) return false;
    if (a.color !== b.color) return false;

    // Allow for small floating point differences
    const EPSILON = 0.001;

    if (a.type === 'text') {
        if (a.text !== b.text) return false;
        if (Math.abs(a.size - b.size) > EPSILON) return false;
        if (Math.abs(a.x - b.x) > EPSILON) return false;
        if (Math.abs(a.y - b.y) > EPSILON) return false;
        return true;
    }

    if (a.type === 'path') {
        if (Math.abs(a.width - b.width) > EPSILON) return false;
        if (a.points.length !== b.points.length) return false;

        // Check first, middle, and last points first for speed
        // Then check all if needed
        for (let i = 0; i < a.points.length; i++) {
            if (Math.abs(a.points[i].x - b.points[i].x) > EPSILON) return false;
            if (Math.abs(a.points[i].y - b.points[i].y) > EPSILON) return false;
        }
        return true;
    }

    return false;
}
