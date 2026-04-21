import { ContactForm } from "@/components/contact-form";

export default function ContactPage() {
  return (
    <section className="px-0 pb-20 pt-[28px] md:pb-24 md:pt-[112px]">
      <div className="mx-auto max-w-3xl space-y-8">
        <div className="space-y-3 text-[#2f1b0f]">
          <p className="text-xs uppercase tracking-[0.3em] text-[#b68c5a]">Contact</p>
          <h1 className="text-3xl font-semibold md:text-4xl">お問い合わせ</h1>
          <p className="max-w-2xl text-sm leading-7 text-[#4a3121] md:text-base">
            ご予約に関するご相談やその他のお問い合わせはこちらからご連絡ください。内容を確認のうえ、順次ご返信いたします。
          </p>
        </div>

        <div className="card border-[#cfa96d]/35 bg-[#fffdfa] p-6 md:p-8">
          <ContactForm />
        </div>
      </div>
    </section>
  );
}
