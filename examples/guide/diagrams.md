# Diagrams with Mermaid

`mermaid` code blocks are drawn as diagrams and follow your system's light or dark theme.

## Order flow

```mermaid
flowchart LR
  A[Customer builds the order] --> B{In stock?}
  B -- Yes --> C[Confirm and charge]
  B -- No --> D[Notify the customer]
  C --> E[Prepare]
  E --> F[Deliver]
```

## Booking an appointment

```mermaid
sequenceDiagram
  participant C as Customer
  participant S as System
  participant P as Professional
  C->>S: Request an appointment
  S->>P: Check availability
  P-->>S: Free slots
  S-->>C: Offer slots
  C->>S: Confirm
```

More on the same topic in the [project plan](../project/plan.md).
