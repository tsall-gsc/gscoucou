import Image from "next/image";

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-7xl mx-auto">

        <h1 className="text-4xl font-bold text-blue-700">
          GS CouCou School Management System
        </h1>

        <p className="mt-2 text-gray-600">
          Student Registration, Teachers, Fees and Expenses Management
        </p>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mt-10">

          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold">
              Students
            </h2>
            <p className="text-3xl font-bold text-blue-600 mt-2">
              0
            </p>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold">
              Teachers
            </h2>
            <p className="text-3xl font-bold text-green-600 mt-2">
              0
            </p>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold">
              Fees Collected
            </h2>
            <p className="text-3xl font-bold text-purple-600 mt-2">
              0 GNF
            </p>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold">
              Expenses
            </h2>
            <p className="text-3xl font-bold text-red-600 mt-2">
              0 GNF
            </p>
          </div>

        </div>

        <div className="mt-10 bg-white rounded-lg shadow p-6">
          <h2 className="text-2xl font-bold mb-4">
            Welcome
          </h2>

          <p>
            This system will manage:
          </p>

          <ul className="list-disc ml-6 mt-2">
            <li>Students</li>
            <li>Teachers</li>
            <li>School Fees</li>
            <li>Expenses</li>
            <li>Reports</li>
            <li>Excel Import</li>
          </ul>
        </div>

      </div>
    </main>
  );
}
