# Usual products

One repository: **[pauljump/usual](https://github.com/pauljump/usual)**. Star Usual for the collection.

Every product has `products/<slug>/README.md` and an entry in `registry.json`.
Independent packages keep source, tests, dependencies and deployment configuration in their product directory.
Products sharing the Python runtime keep their implementation in `src/usual/` and link to it from their product directory.
Private runtime data, credentials and user corpora live outside version control. Vendor licenses stay with their code.
Product source ownership does not make private workshops or experiments public website menu items.

| Product | Source | Status |
| --- | --- | --- |
| [Vibecheck](vibecheck/README.md) | `src/usual/` | public |
| [Choices](choices/README.md) | `src/usual/` | public |
| [Recall](recall/README.md) | `src/usual/recall_core/` | public |
| [Loops](loops/README.md) | `src/usual/loops.py` | public |
| [Pop](pop/README.md) | `src/usual/pop.html` | public |
| [Escape](escape/README.md) | `products/escape/` | public |
| [Where](where/README.md) | `src/usual/where.py` | public |
| [Proof](proof/README.md) | `src/usual/proof_jam.py` | private workshop |
| [Teek](teek/README.md) | `src/usual/teek.py` | private hub |
| [Bait](bait/README.md) | `src/usual/bait/` | public |
| [Bait Lab](bait-lab/README.md) | `products/bait-lab/` | experiment |
| [Bait for Shopify](bait-shopify/README.md) | `products/bait-shopify/` | development |
| [Thought Swarm](thought-swarm/README.md) | `products/thought-swarm/` | public |
| [Usual Keyboard](keyboard/README.md) | `products/keyboard/` | development |
