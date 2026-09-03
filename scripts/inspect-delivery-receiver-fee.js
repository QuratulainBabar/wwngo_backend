import 'dotenv/config';
import { pool } from '../src/db/pool.js';
import { senderPaysReceiverFee, receiverPlatformFeeCents } from '../src/utils/fees.js';

const publicId = process.argv[2] || 'WW-24015';

const { rows: cols } = await pool.query(
  `SELECT column_name FROM information_schema.columns
   WHERE table_name = 'deliveries'
     AND (column_name ILIKE '%fee%' OR column_name ILIKE '%pay%' OR column_name ILIKE '%receiver%' OR column_name ILIKE '%platform%')
   ORDER BY column_name`
);
console.log('fee columns:', cols.map((c) => c.column_name));

const { rows } = await pool.query(
  `SELECT d.*,
          s.email AS sender_email, r.email AS receiver_email,
          w.available_cents AS receiver_available, w.escrow_cents AS receiver_escrow
   FROM deliveries d
   JOIN users s ON s.id = d.sender_id
   LEFT JOIN users r ON r.id = d.receiver_id
   LEFT JOIN wallets w ON w.user_id = d.receiver_id
   WHERE d.public_id = $1`,
  [publicId]
);

const d = rows[0];
if (!d) {
  console.log('Delivery not found:', publicId);
  await pool.end();
  process.exit(1);
}

const deliveryLike = {
  paysReceiverFee: d.pays_receiver_fee,
  platformFeeShare: d.platform_fee_share == null ? null : Number(d.platform_fee_share),
  parcelCategory: d.parcel_category,
};

const pays = senderPaysReceiverFee(deliveryLike);
const feeCents = receiverPlatformFeeCents(d.parcel_category, pays);

console.log(
  JSON.stringify(
    {
      publicId: d.public_id,
      status: d.status,
      parcelCategory: d.parcel_category,
      pays_receiver_fee: d.pays_receiver_fee,
      platform_fee_share: d.platform_fee_share,
      senderPaysReceiverFee: pays,
      receiverFeeDueUsd: feeCents / 100,
      receiver_accepted_at: d.receiver_accepted_at,
      receiver_paid_at: d.receiver_paid_at,
      sender_email: d.sender_email,
      receiver_email: d.receiver_email,
      receiver_wallet_available_usd: Number(d.receiver_available || 0) / 100,
      explanation:
        feeCents === 0
          ? 'Accept allowed with $0 wallet because sender covers receiver platform fee (no charge on accept).'
          : 'Receiver should have been charged a platform fee — investigate if fee was skipped.',
    },
    null,
    2
  )
);

await pool.end();
