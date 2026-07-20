package com.blackgrapes.slmtoolbox.map

/**
 * Replaceable OSM-compatible raster style.
 * Swap [TILE_URL_TEMPLATE] for your licensed/self-hosted tile provider in production.
 */
object MapStyleConfig {
    // OpenFreeMap raster tiles are OSM-based and suitable for development.
    // For production, point this to your own tile endpoint or commercial provider.
    const val TILE_URL_TEMPLATE =
        "https://tiles.openfreemap.org/natural_earth/{z}/{x}/{y}.png"

    // Higher-detail fallback for street/building zoom (OSM raster via OpenFreeMap liberty style URL).
    const val STYLE_URL = "https://tiles.openfreemap.org/styles/liberty"

    const val DEFAULT_LATITUDE = 28.6139
    const val DEFAULT_LONGITUDE = 77.2090
    const val FIELD_ZOOM = 18.0
    const val PREVIEW_PADDING_PX = 80
    const val ATTRIBUTION = "© OpenStreetMap contributors © OpenFreeMap"
}
