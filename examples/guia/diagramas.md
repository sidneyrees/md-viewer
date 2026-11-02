# Diagramas con Mermaid

Los bloques de código `mermaid` se dibujan como diagramas y siguen el tema claro u oscuro del sistema.

## Flujo de un pedido

```mermaid
flowchart LR
  A[Cliente arma el pedido] --> B{¿Hay stock?}
  B -- Sí --> C[Confirmar y cobrar]
  B -- No --> D[Avisar al cliente]
  C --> E[Preparar]
  E --> F[Entregar]
```

## Reserva de un turno

```mermaid
sequenceDiagram
  participant C as Cliente
  participant S as Sistema
  participant P as Profesional
  C->>S: Pide un turno
  S->>P: Consulta disponibilidad
  P-->>S: Horarios libres
  S-->>C: Ofrece horarios
  C->>S: Confirma
```

Más material sobre el mismo tema en el [plan del proyecto](../proyecto/plan.md).
