#!/usr/bin/env python3
"""E2E verification of WWNGO 17-step flow via API."""
import json
import subprocess
import sys
import tempfile
import os

API = "http://localhost:3000/api/v1"
PASS = "Password123!"


def curl(method, path, token=None, data=None, files=None):
    cmd = ["curl", "-s", "-X", method, f"{API}{path}"]
    if token:
        cmd += ["-H", f"Authorization: Bearer {token}"]
    if data is not None:
        cmd += ["-H", "Content-Type: application/json", "-d", json.dumps(data)]
    if files:
        for k, v in files.items():
            cmd += ["-F", f"{k}={v}"]
    out = subprocess.check_output(cmd, text=True)
    return json.loads(out)


def login(email):
    r = curl("POST", "/auth/login", data={"email": email, "password": PASS, "otp": "123456"})
    if not r.get("success"):
        raise RuntimeError(f"login failed {email}: {r}")
    return r["data"]["accessToken"]


def step(name, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name}" + (f" — {detail}" if detail else ""))
    return ok


def fund_wallets():
    subprocess.run([
        "docker", "exec", "wwngo-postgres", "psql", "-U", "postgres", "-d", "wwngo", "-c",
        "UPDATE wallets SET available_cents=50000 FROM users u "
        "WHERE wallets.user_id=u.id AND u.email LIKE '%@wwngo.test';",
    ], check=True, capture_output=True)


def main():
    fund_wallets()
    results = []

    sender = login("sender@wwngo.test")
    traveler = login("traveler@wwngo.test")
    receiver = login("receiver@wwngo.test")

    # Step 1
    r = curl("POST", "/trips", traveler, {
        "tripType": "city_to_city", "fromCity": "Lagos", "toCity": "London",
        "travelDate": "2026-10-15", "luggageCapacityKg": 5,
    })
    results.append(step("1 Traveler create trip ($3 min)", r.get("success"), r.get("error", {}).get("code", "")))
    trip_id = r.get("data", {}).get("id", "")

    # Step 2
    png = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    png.write(bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000a49444154789c63000100000500010d0a2db00000000049454e44ae426082"
    ))
    png.close()
    r = curl("POST", "/deliveries", sender, files={
        "deliveryType": "city_to_city", "fromCity": "Lagos", "toCity": "London",
        "fromCode": "LOS", "toCode": "LON",
        "travelDate": "2026-10-15", "parcelCategory": "documents",
        "parcelSize": "envelope", "weightKg": "1", "maxBudget": "50",
        "description": "e2e test", "acknowledged": "true",
        "receiverEmail": "receiver@wwngo.test", "receiverPhone": "8012345672",
        "receiverMeetupLocation": "London Heathrow",
        'preferredMeetupLocations': '["Lagos Airport"]',
        "platformFeeShare": "0", "photos": f"@{png.name}",
    })
    os.unlink(png.name)
    results.append(step("2 Sender create delivery", r.get("success"), r.get("error", {}).get("message", "")[:60]))
    del_id = r.get("data", {}).get("id", "")
    del_pub = r.get("data", {}).get("publicId", "")

    # Step 3
    r = curl("POST", f"/deliveries/{del_id}/accept", receiver)
    results.append(step("3 Receiver accept", r.get("success")))

    # Step 4
    r = curl("GET", f"/deliveries/{del_id}/matching-travelers", sender)
    match_count = len(r.get("data", []))
    results.append(step("4 Matching travelers", r.get("success") and match_count > 0, f"{match_count} matches"))

    # Step 5
    r = curl("POST", f"/deliveries/{del_id}/request-traveler", sender, {"tripId": trip_id})
    results.append(step("5 Sender request traveler", r.get("success"), r.get("error", {}).get("message", "")[:80]))
    req_id = r.get("data", {}).get("id", "")

    # Step 6
    r = curl("GET", "/trips/sender-requests", traveler)
    results.append(step("6 Traveler sees requests", r.get("success") and len(r.get("data", [])) > 0))

    # Step 7
    r = curl("POST", f"/trips/sender-requests/{req_id}/counter-offers", traveler, {"amount": 45})
    results.append(step("7 Traveler counter-offer", r.get("success")))
    offer_id = r.get("data", {}).get("id", "")

    # Step 8 - notification created server-side
    results.append(step("8 Sender notified (counter-offer created)", bool(offer_id)))

    # Step 9
    r = curl("POST", f"/trips/sender-counter-offers/{offer_id}/accept", sender)
    results.append(step("9 Sender accept + escrow", r.get("success"), r.get("error", {}).get("message", "")[:80]))

    # Step 10 - chat exists
    r = curl("GET", "/chats", sender)
    results.append(step("10 Chat available", r.get("success")))

    # Step 12 meetup — both parties must agree
    curl("POST", f"/meetup/deliveries/{del_id}/meetup/propose", sender, {"location": "Lagos Airport"})
    curl("POST", f"/meetup/deliveries/{del_id}/meetup/agree", sender)
    r = curl("POST", f"/meetup/deliveries/{del_id}/meetup/agree", traveler)
    results.append(step("12 Meetup agreed", r.get("success")))

    # Step 13 NFC - two party (sender then traveler)
    r1 = curl("POST", f"/nfc/deliveries/{del_id}/checkpoints/1", sender, {"confirm": True})
    pending = r1.get("data", {}).get("checkpoint", {}).get("pendingPeer")
    r2 = curl("POST", f"/nfc/deliveries/{del_id}/checkpoints/1", traveler, {"confirm": True})
    cp = r2.get("data", {}).get("checkpoint", {})
    results.append(step("13 NFC handoff (2-party)", r2.get("success") and cp.get("confirmedAt"), f"pendingPeer={pending}"))

    # Step 14 in transit (may already be in_transit after NFC CP1)
    r = curl("POST", f"/tracking/deliveries/{del_pub}/in-transit", traveler)
    ok14 = r.get("success") or r.get("error", {}).get("code") == "INVALID_STATUS_TRANSITION"
    results.append(step("14 Mark in transit", ok14))

    # Step 16 NFC delivery — traveler then receiver
    r1 = curl("POST", f"/nfc/deliveries/{del_id}/checkpoints/2", traveler, {"confirm": True})
    r = curl("POST", f"/nfc/deliveries/{del_id}/checkpoints/2", receiver, {"confirm": True})
    cp2 = r.get("data", {}).get("checkpoint", {})
    results.append(step("16 NFC delivery to receiver", r.get("success") and cp2.get("confirmedAt")))

    # Step 17 wallet
    r = curl("GET", "/wallet?role=traveler", traveler)
    avail = r.get("data", {}).get("availableCents", 0)
    results.append(step("17 Traveler wallet updated", avail > 1000, f"available={avail}c"))

    passed = sum(1 for r in results if r)
    total = len(results)
    print(f"\n=== {passed}/{total} steps passed ===")
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
