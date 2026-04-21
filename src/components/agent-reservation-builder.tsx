"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getAllowedArrivalTimesForServicePeriod,
  getDefaultArrivalTimeForCourse,
  inferReservationServicePeriodFromCourse,
  isArrivalTimeAllowed,
} from "@/lib/booking-rules";
import { formatJst } from "@/lib/dates";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getReservationCoursesForServicePeriod,
  RESERVATION_CUTOFF_TEXT,
  type ReservationServicePeriodKey,
} from "@/lib/reservation-config";
import { getNextBookableReservationDate } from "@/lib/booking-rules";

function getDefaultDate() {
  return formatJst(getNextBookableReservationDate());
}

export function AgentReservationBuilder() {
  const [date, setDate] = useState(getDefaultDate);
  const [partySize, setPartySize] = useState("2");
  const [servicePeriod, setServicePeriod] = useState<ReservationServicePeriodKey>("LUNCH");
  const [course, setCourse] = useState<string>(() => {
    const fallback = getReservationCoursesForServicePeriod("LUNCH")[0]?.value;
    return fallback ?? "";
  });
  const [arrivalTime, setArrivalTime] = useState(() =>
    getDefaultArrivalTimeForCourse(undefined, "LUNCH")
  );
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  const courseOptions = useMemo(
    () => getReservationCoursesForServicePeriod(servicePeriod),
    [servicePeriod]
  );
  const arrivalTimeOptions = useMemo(
    () => getAllowedArrivalTimesForServicePeriod(servicePeriod),
    [servicePeriod]
  );

  useEffect(() => {
    const nextCourse = courseOptions.some((option) => option.value === course)
      ? course
      : (courseOptions[0]?.value ?? "");
    const nextArrivalTime = isArrivalTimeAllowed(arrivalTime, undefined, servicePeriod)
      ? arrivalTime
      : getDefaultArrivalTimeForCourse(undefined, servicePeriod);

    if (nextCourse !== course) {
      setCourse(nextCourse);
    }

    if (nextArrivalTime !== arrivalTime) {
      setArrivalTime(nextArrivalTime);
    }
  }, [arrivalTime, course, courseOptions, servicePeriod]);

  const params = new URLSearchParams({
    mode: "agent",
    date,
    servicePeriod,
    partySize,
    arrivalTime,
    course,
  });
  const handoffUrl = `/booking?${params.toString()}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(handoffUrl);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }

    window.setTimeout(() => {
      setCopyStatus("idle");
    }, 1800);
  }

  return (
    <div className="mt-5 rounded-2xl border border-[#cfa96d]/40 bg-[#fff7e6] p-4 text-sm text-[#4a3121]">
      <p className="font-semibold text-[#2f1b0f]">Reservation handoff builder</p>
      <p className="mt-2 leading-6">
        Optional fallback for agents that want to hand the guest to `/booking` instead of calling
        `POST /api/reservations` directly. Keep personal data in the POST body, not in this URL.
      </p>
      <p className="mt-2 text-xs leading-6 text-[#7b5a2d]">{RESERVATION_CUTOFF_TEXT}</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="agent-reservation-date">Date</Label>
          <Input
            id="agent-reservation-date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="border-[#b9965a] bg-white"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="agent-reservation-service-period">Service Period</Label>
          <select
            id="agent-reservation-service-period"
            value={servicePeriod}
            onChange={(event) => {
              const next = event.target.value as ReservationServicePeriodKey;
              setServicePeriod(next);
              const nextCourse =
                getReservationCoursesForServicePeriod(next)[0]?.value ?? course;
              setCourse(nextCourse);
              setArrivalTime(getDefaultArrivalTimeForCourse(undefined, next));
            }}
            className="h-10 rounded-md border border-[#b9965a] bg-white px-3 text-sm text-[#2f1b0f] focus:outline-none focus:ring-2 focus:ring-[#8a6233]/25"
          >
            <option value="LUNCH">LUNCH</option>
            <option value="DINNER">DINNER</option>
          </select>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="agent-reservation-party-size">Party Size</Label>
          <select
            id="agent-reservation-party-size"
            value={partySize}
            onChange={(event) => setPartySize(event.target.value)}
            className="h-10 rounded-md border border-[#b9965a] bg-white px-3 text-sm text-[#2f1b0f] focus:outline-none focus:ring-2 focus:ring-[#8a6233]/25"
          >
            {Array.from({ length: 12 }, (_, index) => `${index + 1}`).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="agent-reservation-arrival-time">Arrival Time</Label>
          <select
            id="agent-reservation-arrival-time"
            value={arrivalTime}
            onChange={(event) => setArrivalTime(event.target.value)}
            className="h-10 rounded-md border border-[#b9965a] bg-white px-3 text-sm text-[#2f1b0f] focus:outline-none focus:ring-2 focus:ring-[#8a6233]/25"
          >
            {arrivalTimeOptions.map((time) => (
              <option key={time} value={time}>
                {time}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="agent-reservation-course">Course</Label>
          <select
            id="agent-reservation-course"
            value={course}
            onChange={(event) => {
              const nextCourse = event.target.value;
              setCourse(nextCourse);
              const nextPeriod = inferReservationServicePeriodFromCourse(nextCourse);
              if (nextPeriod && nextPeriod !== servicePeriod) {
                setServicePeriod(nextPeriod);
              }
            }}
            className="h-10 rounded-md border border-[#b9965a] bg-white px-3 text-sm text-[#2f1b0f] focus:outline-none focus:ring-2 focus:ring-[#8a6233]/25"
          >
            {courseOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 grid gap-2">
        <Label htmlFor="agent-reservation-handoff-url">Generated handoff URL</Label>
        <Input
          id="agent-reservation-handoff-url"
          readOnly
          value={handoffUrl}
          className="border-[#b9965a] bg-white text-xs"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <a
          href={handoffUrl}
          className="inline-flex items-center justify-center rounded-full bg-[#2f1b0f] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
        >
          Open Handoff
        </a>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center justify-center rounded-full border border-[#2f1b0f] px-4 py-2 text-sm font-semibold text-[#2f1b0f] transition hover:bg-white/70"
        >
          Copy URL
        </button>
        {copyStatus === "copied" ? <span className="text-xs text-[#7b5a2d]">Copied</span> : null}
        {copyStatus === "failed" ? (
          <span className="text-xs text-[#9f2b2b]">Copy failed</span>
        ) : null}
      </div>
    </div>
  );
}
