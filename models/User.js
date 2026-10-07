const { Schema, model } = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "email is not valid"],
    },
    phone: { type: String, trim: true },
    password: { type: String, required: true, minlength: [8, "password must be at least 8 characters"], select: false },
    role: { type: String, enum: ["manager", "driver"], required: true },
    // The manager a driver belongs to
    manager: { type: Schema.Types.ObjectId, ref: "User", index: true },
    fcmTokens: { type: [String], select: false },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: (doc, ret) => {
        delete ret.password;
        delete ret.fcmTokens;
        return ret;
      },
    },
  },
);

userSchema.pre("save", async function () {
  if (this.isModified("password")) {
    this.password = await bcrypt.hash(this.password, 10);
  }
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = model("User", userSchema);
