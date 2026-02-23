# DESCRIZIONE
Attualmente la skill ha un design monolitico. La singola skill si occupa di:
    - Generare lo scheletro, fare la parte expert enhancement
    - Update delle skills
Non ha una specifica sul come utilizzare le service skills!

Propongo una separazione dei concetti, suddividendo la service skill in:
    - Creating-service-skills - si occuperà strettamente della generazione degli scheletri, aggregazione per appartenenza logica;
    - updating-service-skills - update delle service skills, similmente alla skill /documenting
    - using-service-skills - spiega come utilizzarle e LISTA le service skills disponibili per l'agente. Questa è la nuova feature importante, in quanto ispirandosi alla skill using-superpowers, indica precisamente all'agente cosa sono, quali sono, e in quali casi utilizzarle. Queste, quando siamo all'interno del progetto, ovviamente devono essere injected all'agente in modo forzato. Using-superpowers credo utilizzi un hook a sessionstart per ottenere questo risultato.

PROBLEMA: usando skill sync rimangono hardcoded determinati path specifici di una skill di un agente esempio `.claude` e non va bene.
La soluzione potrebbe essere rendere gli script utility come il `db_query.py` agent agnostic, e farli puntare a una directory generica, dalla root del progetto, accessibile da qualsiasi agent. Questo eviterebbe anche la duplicazione di 4x scripts.