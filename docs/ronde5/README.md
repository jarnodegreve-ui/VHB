# Ronde 5 (22-09-2026): ontwerpnota's

Drie read-only onderzoeken, geschreven vóór er iets gebouwd werd, als onderbouwing voor de productbeslissingen van Jarno. Ze beschrijven de code zoals ze op 22-09 op `main` stond (regelnummers kunnen sindsdien verschuiven).

- `deeplinks-en-dienstruil.md`: waarom "Overzicht" niet hernoemd of tot inbox omgebouwd hoeft te worden om vanuit Dashboard, Vandaag, Overzicht en meldingen rechtstreeks een record te openen (variant V1), en waarom Dienstruil niet permanent in het chauffeursdock hoeft (optie O2: contextueel plus een zichtbaar inkomend verzoek). Met klikaantallen en wireframes.
- `dienstoverzicht-samenvoeging.md`: ontwerp om Dienstoverzicht en Beheer dienstoverzicht samen te voegen tot één scherm met een rolafhankelijke beheerlaag in een aparte chunk, zonder een server-regel te raken; migratie in vier kleine PR's.
- `mutaties-en-caching.md`: classificatie van alle 103 schrijfacties in A (volledig optimistisch), B (optimistisch met pending-staat) en C (server-bevestigd), plus de maximale versheid per databron. Uitkomst: 14 A, 17 B, 67 C.
