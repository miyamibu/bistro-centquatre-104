"use client";

import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import CancelButton from "@/components/cancel-button";

export type AdminReservationListItem = {
  id: string;
  date: string;
  servicePeriod: "LUNCH" | "DINNER";
  servicePeriodLabel: string;
  arrivalTime: string | null;
  course: string | null;
  partySize: number;
  name: string;
  phone: string;
  request: string | null;
  cancelDisabled: boolean;
};

function formatSelectedDate(date: string) {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return date;

  const [, , month, day] = match;
  return `${Number(month)}月${Number(day)}日`;
}

function RequestText({ request }: { request: string | null }) {
  return (
    <p className="whitespace-pre-wrap text-sm leading-6 text-gray-700">
      {`要望: ${request ?? "なし"}`}
    </p>
  );
}

function ReservationSectionHeader({
  title,
  reservations,
}: {
  title: string;
  reservations: AdminReservationListItem[];
}) {
  const partyTotal = reservations.reduce((sum, reservation) => sum + reservation.partySize, 0);

  return (
    <div className="flex items-end justify-between gap-3">
      <h3 className="text-base font-semibold text-gray-900">{title}</h3>
      <p className="text-sm text-gray-600">
        {reservations.length}組 / {partyTotal}名
      </p>
    </div>
  );
}

export function AdminReservationsList({
  selectedDate,
  reservations,
}: {
  selectedDate: string;
  reservations: AdminReservationListItem[];
}) {
  const [openRequests, setOpenRequests] = useState<Record<string, boolean>>({});
  const lunchReservations = reservations.filter((reservation) => reservation.servicePeriod === "LUNCH");
  const dinnerReservations = reservations.filter(
    (reservation) => reservation.servicePeriod === "DINNER"
  );

  function toggleRequest(id: string) {
    setOpenRequests((current) => ({
      ...current,
      [id]: !current[id],
    }));
  }

  function renderMobileSection(
    title: string,
    sectionReservations: AdminReservationListItem[]
  ) {
    return (
      <section className="space-y-3">
        <ReservationSectionHeader title={title} reservations={sectionReservations} />
        {sectionReservations.length === 0 ? (
          <div className="card border-0 p-4 text-sm text-gray-600 shadow-none">
            予約はありません。
          </div>
        ) : (
          sectionReservations.map((reservation) => {
            const isOpen = !!openRequests[reservation.id];

            return (
              <div key={reservation.id} className="card border-0 p-4 shadow-none">
                <div className="space-y-2 text-[15px] text-gray-700">
                  <p>
                    <span className="font-medium text-gray-900">来店目安:</span>{" "}
                    {reservation.arrivalTime ?? "-"}
                  </p>
                  <p>
                    <span className="font-medium text-gray-900">コース:</span>{" "}
                    {reservation.course ?? "-"}
                  </p>
                  <p>
                    <span className="font-medium text-gray-900">人数:</span> {reservation.partySize}名
                  </p>
                  <p>
                    <span className="font-medium text-gray-900">氏名:</span> {reservation.name}
                  </p>
                  <p>
                    <span className="font-medium text-gray-900">電話:</span> {reservation.phone}
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => toggleRequest(reservation.id)}
                    aria-expanded={isOpen}
                  >
                    {isOpen ? "要望を閉じる" : "要望"}
                  </Button>
                  <CancelButton
                    id={reservation.id}
                    disabled={reservation.cancelDisabled}
                  />
                </div>

                {isOpen ? (
                  <div className="mt-4 rounded-md bg-[#f8f5ef] px-4 py-3">
                    <RequestText request={reservation.request} />
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </section>
    );
  }

  function renderDesktopSection(
    title: string,
    sectionReservations: AdminReservationListItem[]
  ) {
    return (
      <section className="space-y-3">
        <ReservationSectionHeader title={title} reservations={sectionReservations} />
        <div className="card border-0 shadow-none overflow-hidden">
          <table className="min-w-full">
            <thead className="bg-gray-50 text-left text-sm text-gray-600">
              <tr>
                <th className="px-4 py-2">来店目安</th>
                <th className="px-4 py-2">コース</th>
                <th className="px-4 py-2">人数</th>
                <th className="px-4 py-2">氏名</th>
                <th className="px-4 py-2">電話</th>
                <th className="w-[12rem] px-4 py-2">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-[15px]">
              {sectionReservations.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-gray-500" colSpan={6}>
                    予約はありません。
                  </td>
                </tr>
              ) : (
                sectionReservations.map((reservation) => {
                  const isOpen = !!openRequests[reservation.id];

                  return (
                    <Fragment key={reservation.id}>
                      <tr className="hover:bg-gray-50">
                        <td className="px-4 py-2">{reservation.arrivalTime ?? "-"}</td>
                        <td className="px-4 py-2">{reservation.course ?? "-"}</td>
                        <td className="px-4 py-2">{reservation.partySize}名</td>
                        <td className="px-4 py-2">{reservation.name}</td>
                        <td className="px-4 py-2">{reservation.phone}</td>
                        <td className="w-[12rem] px-4 py-2">
                          <div className="-ml-2 flex items-center gap-2 whitespace-nowrap">
                            <Button
                              size="sm"
                              className="w-[7rem]"
                              onClick={() => toggleRequest(reservation.id)}
                              aria-expanded={isOpen}
                            >
                              {isOpen ? "要望を閉じる" : "要望"}
                            </Button>
                            <CancelButton
                              id={reservation.id}
                              disabled={reservation.cancelDisabled}
                            />
                          </div>
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr className="bg-[#f8f5ef]">
                          <td className="px-4 py-3" colSpan={6}>
                            <RequestText request={reservation.request} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  return (
    <>
      <div className="pb-1 text-center">
        <p className="text-xl font-semibold text-gray-900 md:text-2xl">
          {formatSelectedDate(selectedDate)}
        </p>
      </div>

      <div className="space-y-6 md:hidden">
        {renderMobileSection("ランチ", lunchReservations)}
        {renderMobileSection("ディナー", dinnerReservations)}
      </div>

      <div className="hidden space-y-6 md:block">
        {renderDesktopSection("ランチ", lunchReservations)}
        {renderDesktopSection("ディナー", dinnerReservations)}
      </div>
    </>
  );
}
