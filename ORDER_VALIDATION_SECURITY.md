# Order Price Validation Security

## Problem
The order API was accepting and storing client-submitted `items` and `total` without server-side validation. This allowed attackers to:
- Modify product prices
- Submit fake discounts
- Add non-existent products
- Submit arbitrary totals

## Solution
Implemented server-side price validation and recalculation:

### 1. Menu Item Verification
```typescript
const menuItems = await prisma.menuItem.findMany({
  where: {
    id: { in: body.items.map((item) => item.id) },
    isPublished: true, // Only published items allowed
  },
})

// Verify all submitted items exist in database
if (menuItems.length !== body.items.length) {
  throw new Error('Invalid products included')
}
```

### 2. Server-Side Total Calculation
```typescript
const calculatedTotal = body.items.reduce((sum, clientItem) => {
  const menuItem = menuItems.find((m) => m.id === clientItem.id)
  
  // Validate quantity
  if (!clientItem.quantity || clientItem.quantity <= 0 || !Number.isInteger(clientItem.quantity)) {
    throw new Error('Invalid quantity')
  }
  
  // Use SERVER price, not client price
  return sum + menuItem.price * clientItem.quantity
}, 0)
```

### 3. Total Mismatch Detection
```typescript
// Compare client-submitted total with server calculation
if (calculatedTotal !== body.total) {
  // Log suspicious behavior (potential tampering)
  console.warn(`Order total mismatch: client=${body.total}, calculated=${calculatedTotal}`)
  return NextResponse.json({ error: 'Invalid order total' }, { status: 400 })
}
```

### 4. Save Verified Data
```typescript
// Save with server-validated prices and total, NOT client data
const { data: order } = await supabaseServer.from('orders').insert([
  {
    items: validatedItems,      // Server-rebuilt from verified menu items
    total: calculatedTotal,      // Server-calculated, not client-submitted
    // ... other fields
  },
])
```

## Protection Against Attacks

| Attack Vector | Prevention |
|---|---|
| **Price tampering** | Only server menu prices used in calculation |
| **Quantity manipulation** | Validated as positive integer |
| **Non-existent products** | Checked against published menu |
| **Fake discounts** | Total recalculated and compared |
| **Unpublished items** | `isPublished: true` filter |

## Implementation Details

File: `src/app/api/orders/route.ts`

### Before (Vulnerable)
```typescript
// ❌ BAD: Trusting client data directly
const { data: order } = await supabaseServer.from('orders').insert([
  {
    items: body.items,          // Client data!
    total: body.total,          // Client data!
  },
])
```

### After (Secure)
```typescript
// ✅ GOOD: Server-verified data
const validatedItems = body.items.map((clientItem) => {
  const menuItem = menuItems.find((m) => m.id === clientItem.id)!
  return {
    id: menuItem.id,
    name: menuItem.title,
    price: menuItem.price,      // Server price
    quantity: clientItem.quantity,
  }
})

const { data: order } = await supabaseServer.from('orders').insert([
  {
    items: validatedItems,      // Verified items
    total: calculatedTotal,     // Recalculated total
  },
])
```

## Logging for Fraud Detection

When a mismatch is detected:
```
Order total mismatch: client=5000, calculated=9800
Items: [
  { id: 'dish-1', name: 'Pasta', quantity: 2, price: 4900 },  // Server price
  { id: 'drink-1', name: 'Wine', quantity: 1, price: 1000 }   // Server price
]
```

This log helps detect:
- Price modification attempts
- Duplicate submissions with lower amounts
- Automated scraping/fuzzing attacks

## Frontend Implications

The client should:
1. Display menu prices from server (not hardcoded)
2. Calculate totals for display only
3. Send both `items` and `total` to order API
4. Handle 400 error if total mismatch detected
5. Do NOT allow price editing in browser dev tools before submission

## Related Security

- See `SECURITY_ARCHITECTURE.md` for Supabase key separation
- See middleware authentication for admin dashboard
- Input validation should also check customer info (name, email, etc.)

## Testing Checklist

- [ ] Normal order submission works
- [ ] Modifying item price in DevTools is rejected
- [ ] Manipulating total in DevTools is rejected
- [ ] Non-existent product IDs are rejected
- [ ] Unpublished items are rejected
- [ ] Negative quantity is rejected
- [ ] Zero quantity is rejected
- [ ] Non-integer quantity is rejected
- [ ] Server logs capture attack attempts
