export default function PaymentCancelPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center"
      style={{ background: '#f8fafc' }}>
      <div className="bg-white rounded-2xl p-10 text-center shadow-lg">
        <i className="fas fa-times-circle text-red-500 text-6xl mb-4" />
        <h1 className="text-2xl font-extrabold text-[#1d2b4b] mb-2">Payment Cancelled</h1>
        <p className="text-slate-400 mb-6">Your payment was not completed.</p>
        <a href="/premium" className="px-6 py-3 bg-[#1d2b4b] text-white rounded-xl font-bold">
          Try Again
        </a>
      </div>
    </div>
  );
}
