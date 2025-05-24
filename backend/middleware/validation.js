const joi = require('joi');

// Validation middleware factory
const validate = (schema) => {
    return (req, res, next) => {
        const { error } = schema.validate(req.body);
        if (error) {
            return res.status(400).json({
                error: error.details[0].message
            });
        }
        next();
    };
};

// Auth validations
const validateRegister = validate(joi.object({
    email: joi.string().email().required(),
    password: joi.string().min(6).required(),
    username: joi.string().min(3).max(30).required()
}));

const validateLogin = validate(joi.object({
    email: joi.string().email().required(),
    password: joi.string().required()
}));

// Add other validations as needed...

module.exports = {
    validate,
    validateRegister,
    validateLogin
};
